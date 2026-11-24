import {
  AuditAction,
  COMMITTEE_PAGE_SIZE,
  type Actor,
  type ActorType,
  type AddedNote,
  type ApplicationCommand,
  type AuditActor,
  type CommandPayload,
  type CommitteeApplication,
  type CommitteeApplicationPage,
  type CommitteeDashboard,
  type HistoryItem,
  type ListApplicationsInput,
  type SchoolKey,
} from "@mbs/api-contract";
import type { Database } from "@mbs/db";
import { isSchoolKey, SCHOOL_KEYS } from "@mbs/school-config";

import { NotFoundError } from "../../errors.ts";
import { appendAuditLog } from "../audit.ts";
import type { StaffContext } from "../auth/authorization.ts";
import type { OutboxSettings } from "../notification/outbox.ts";
import {
  countForDashboard,
  findCommitteeApplication,
  findCommitteeCycle,
  isInCommitteeScope,
  listAuditRows,
  listCommitteeApplications,
  listEventsWithActors,
  listRecentEvents,
} from "./committee-repository.ts";
import { addNote, type RequestMeta } from "./service.ts";
import { isEndStage, needsCommittee } from "./stages.ts";

// Reads answer NOT_FOUND for another school's application, never FORBIDDEN, so
// a staff member cannot learn which ids exist elsewhere.

export const VIEWED_ACTION = "application.viewed";

const RECENT_ACTIVITY = 5;

export async function loadDashboard(
  db: Database,
  staff: StaffContext,
): Promise<CommitteeDashboard> {
  const cycle = await findCommitteeCycle(db);
  // In the schools' own order, SMP to SMA, as every list of them reads.
  const schoolKeys = SCHOOL_KEYS.filter((key) => staff.schoolKeys.includes(key));
  const empty: CommitteeDashboard = {
    cycle: cycle && { name: cycle.name, closesAt: cycle.closesAt.toISOString() },
    total: 0,
    newThisWeek: 0,
    paid: 0,
    needsCommittee: 0,
    oldestWaitingSince: null,
    accepted: 0,
    decided: 0,
    perSchool: schoolKeys.map((schoolKey) => ({ schoolKey, total: 0 })),
    recent: [],
  };
  if (!cycle || schoolKeys.length === 0) return empty;

  const [perSchool, recent] = await Promise.all([
    countForDashboard(db, schoolKeys),
    listRecentEvents(db, schoolKeys, RECENT_ACTIVITY),
  ]);
  const sum = (pick: (row: (typeof perSchool)[number]) => number) =>
    perSchool.reduce((total, row) => total + pick(row), 0);
  const oldest = perSchool
    .map((row) => row.oldestWaitingSince)
    .filter((at) => at !== null)
    .map((at) => new Date(at).toISOString())
    .toSorted()[0];
  const counted = new Map(perSchool.map((row) => [row.schoolKey, row.total]));
  return {
    ...empty,
    total: sum((row) => row.total),
    newThisWeek: sum((row) => row.newThisWeek),
    paid: sum((row) => row.paid),
    needsCommittee: sum((row) => row.needsCommittee),
    oldestWaitingSince: oldest ?? null,
    decided: sum((row) => row.decided),
    accepted: sum((row) => row.accepted),
    perSchool: schoolKeys.map((schoolKey) => ({ schoolKey, total: counted.get(schoolKey) ?? 0 })),
    recent: recent.map((event) => ({
      applicationId: event.applicationId,
      schoolKey: schoolKeyOf(event.schoolKey),
      childName: event.childName,
      ...eventFields(event),
    })),
  };
}

export async function listForCommittee(
  db: Database,
  staff: StaffContext,
  input: ListApplicationsInput,
): Promise<CommitteeApplicationPage> {
  const schoolKeys = input.school
    ? staff.schoolKeys.filter((key) => key === input.school)
    : staff.schoolKeys;
  const page = { page: input.page, pageSize: COMMITTEE_PAGE_SIZE } as const;
  if (schoolKeys.length === 0) return { rows: [], total: 0, ...page };

  const { rows, total } = await listCommitteeApplications(db, {
    schoolKeys,
    view: input.view,
    q: input.q || undefined,
    limit: COMMITTEE_PAGE_SIZE,
    offset: (input.page - 1) * COMMITTEE_PAGE_SIZE,
  });
  return {
    rows: rows.map((row) => ({
      id: row.id,
      registrationNumber: row.registrationNumber,
      schoolKey: schoolKeyOf(row.schoolKey),
      childName: row.childName,
      guardianName: row.guardianName,
      guardianPhone: row.guardianPhone,
      stage: row.stage,
      needsCommittee: needsCommittee(row.stage),
      stageChangedAt: row.stageChangedAt.toISOString(),
      lastActivity: {
        command: row.lastCommand,
        actorType: row.lastActorType,
        at: row.lastAt.toISOString(),
      },
    })),
    total,
    ...page,
  };
}

/** Writes nothing. The view itself is recorded by `recordView`. */
export async function loadForCommittee(
  db: Database,
  staff: StaffContext,
  applicationId: string,
): Promise<CommitteeApplication> {
  const found = await findCommitteeApplication(db, staff.schoolKeys, applicationId);
  if (!found) throw new NotFoundError("No such application.");

  const [events, audits] = await Promise.all([
    listEventsWithActors(db, found.id),
    listAuditRows(db, found.id),
  ]);
  const familyName = found.profile.guardianName;
  const history: HistoryItem[] = [
    ...events.map((event) => ({
      kind: "EVENT" as const,
      seq: event.seq,
      fromStage: event.fromStage,
      toStage: event.toStage,
      familyVisible: event.familyVisible,
      ...eventFields({ ...event, guardianName: familyName }),
    })),
    ...audits.map((row) => ({
      kind: "AUDIT" as const,
      action: AuditAction.parse(row.action),
      actor: auditActor(row, familyName),
      at: row.createdAt.toISOString(),
    })),
  ].toSorted((a, b) => b.at.localeCompare(a.at));

  return {
    id: found.id,
    registrationNumber: found.registrationNumber,
    schoolKey: schoolKeyOf(found.schoolKey),
    stage: found.stage,
    needsCommittee: needsCommittee(found.stage),
    stageChangedAt: found.stageChangedAt.toISOString(),
    lastEventSeq: found.lastEventSeq,
    profile: found.profile,
    accountEmail: found.accountEmail,
    canAddNote: staff.role !== "PRINCIPAL" && !isEndStage(found.stage),
    history,
  };
}

export async function recordView(
  db: Database,
  staff: StaffContext,
  applicationId: string,
  meta: RequestMeta,
) {
  if (!(await isInCommitteeScope(db, staff.schoolKeys, applicationId))) {
    throw new NotFoundError("No such application.");
  }
  await appendAuditLog(db, {
    actorType: "STAFF",
    actorId: staff.id,
    action: VIEWED_ACTION,
    entityType: "application",
    entityId: applicationId,
    ...meta,
  });
}

/** Through the same command path as every other change, which also refuses a principal. */
export async function addCommitteeNote(
  db: Database,
  staff: StaffContext,
  input: { applicationId: string; note: string; idempotencyKey: string },
  meta: RequestMeta,
  outbox: OutboxSettings,
): Promise<AddedNote> {
  if (!(await isInCommitteeScope(db, staff.schoolKeys, input.applicationId))) {
    throw new NotFoundError("No such application.");
  }
  const { event } = await addNote(db, { ...input, actor: { type: "STAFF", staff }, meta }, outbox);
  return { seq: event.seq };
}

function schoolKeyOf(key: string): SchoolKey {
  if (!isSchoolKey(key)) throw new Error(`Unknown school ${key}.`);
  return key;
}

function eventFields(event: {
  command: ApplicationCommand;
  actorType: ActorType;
  staffName: string | null;
  guardianName: string;
  payload: CommandPayload<ApplicationCommand>;
  createdAt: Date;
}) {
  const { payload } = event;
  return {
    command: event.command,
    actor: eventActor(event.actorType, event.staffName, event.guardianName),
    at: event.createdAt.toISOString(),
    text: "note" in payload ? payload.note : "reason" in payload ? (payload.reason ?? null) : null,
    decision: "decision" in payload ? payload.decision : null,
  };
}

/** A family is named by the guardian on the newest form, which is who the committee calls. */
function eventActor(type: ActorType, staffName: string | null, familyName: string): Actor {
  if (type === "STAFF") return { type, name: staffName };
  if (type === "FAMILY") return { type, name: familyName };
  return { type };
}

/** A family account counts as this child's family only if it holds access to the application. */
function auditActor(
  row: { actorType: string; staffName: string | null; familyHasAccess: boolean },
  familyName: string,
): AuditActor {
  if (row.actorType === "FAMILY" && !row.familyHasAccess) return { type: "OTHER_ACCOUNT" };
  if (row.actorType === "STAFF" || row.actorType === "FAMILY" || row.actorType === "SYSTEM") {
    return eventActor(row.actorType, row.staffName, familyName);
  }
  return { type: "PUBLIC" };
}
