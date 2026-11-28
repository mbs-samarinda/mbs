import {
  AUDIT_ACTIONS,
  VIEWED_ACTION,
  type CommitteeView,
  type SchoolKey,
} from "@mbs/api-contract";
import { schema, type Database } from "@mbs/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  ne,
  or,
  sql,
  type AnyColumn,
} from "drizzle-orm";

import { COMMITTEE_STAGES } from "./stages.ts";

const {
  admissionCycles,
  applicantProfileVersions,
  applicationEvents,
  applications,
  auditLogs,
  schools,
  staffUsers,
  user,
  applicationAccess,
} = schema;

/** The open cycle, or the newest one that has ever opened. */
const CURRENT_CYCLE_ORDER = [
  sql`${admissionCycles.status} = 'OPEN' desc`,
  desc(admissionCycles.registrationOpenAt),
  desc(admissionCycles.id),
];

export async function findCommitteeCycle(db: Database) {
  const rows = await db
    .select({
      id: admissionCycles.id,
      name: admissionCycles.name,
      closesAt: admissionCycles.registrationCloseAt,
    })
    .from(admissionCycles)
    .where(ne(admissionCycles.status, "DRAFT"))
    .orderBy(...CURRENT_CYCLE_ORDER)
    .limit(1);
  return rows[0] ?? null;
}

/** The same choice as `findCommitteeCycle`, inside a query, so a read needs no second trip. */
export const currentCycleId = sql`(
  select ${admissionCycles.id} from ${admissionCycles}
  where ${admissionCycles.status} <> 'DRAFT'
  order by ${sql.join(CURRENT_CYCLE_ORDER, sql`, `)}
  limit 1
)`;

function inScope(schoolKeys: readonly SchoolKey[]) {
  return and(
    eq(applications.admissionCycleId, currentCycleId),
    inArray(schools.key, [...schoolKeys]),
  );
}

function newestProfile(db: Database) {
  return db
    .select({ data: applicantProfileVersions.data })
    .from(applicantProfileVersions)
    .where(eq(applicantProfileVersions.applicationId, applications.id))
    .orderBy(desc(applicantProfileVersions.version))
    .limit(1)
    .as("profile");
}

type Profile = ReturnType<typeof newestProfile>;

const field = (profile: Profile, key: "childFullName" | "guardianName" | "guardianPhone") =>
  sql<string>`${profile.data}->>${key}`;

/** Only a staff actor's id is a staff id; a family's is an account id, which is not a uuid. */
const staffActor = (actorType: AnyColumn, actorId: AnyColumn) =>
  and(sql`${actorType} = 'STAFF'`, sql`${staffUsers.id}::text = ${actorId}`);

function escapeLike(text: string) {
  return text.replaceAll(/[\\%_]/g, "\\$&");
}

export type ListFilter = {
  schoolKeys: readonly SchoolKey[];
  view: CommitteeView;
  q: string | undefined;
  limit: number;
  offset: number;
};

/**
 * One page of the list, and how many rows match. "Perlu dicek" puts the longest
 * wait first; everything else puts the newest activity first. `updated_at` is the
 * newest event's time, so sorting needs no join to the events.
 *
 * The page is chosen first and only its 50 rows are joined to their newest form
 * and event. The form is read for every row only when a search needs it.
 */
export async function listCommitteeApplications(db: Database, filter: ListFilter) {
  const pattern = filter.q ? `%${escapeLike(filter.q)}%` : null;
  const order = [
    filter.view === "NEEDS_COMMITTEE"
      ? asc(applications.stageChangedAt)
      : desc(applications.updatedAt),
    asc(applications.id),
  ];
  const searched = newestProfile(db);
  const where = and(
    inScope(filter.schoolKeys),
    filter.view === "NEEDS_COMMITTEE"
      ? inArray(applications.stage, [...COMMITTEE_STAGES])
      : undefined,
    pattern
      ? or(
          ilike(field(searched, "childFullName"), pattern),
          ilike(field(searched, "guardianName"), pattern),
          ilike(applications.registrationNumber, pattern),
        )
      : undefined,
  );

  let pageQuery = db
    .select({ pageId: applications.id })
    .from(applications)
    .innerJoin(schools, eq(schools.id, applications.schoolId))
    .$dynamic();
  let totalQuery = db
    .select({ total: count() })
    .from(applications)
    .innerJoin(schools, eq(schools.id, applications.schoolId))
    .$dynamic();
  if (pattern) {
    pageQuery = pageQuery.innerJoinLateral(searched, sql`true`);
    totalQuery = totalQuery.innerJoinLateral(searched, sql`true`);
  }

  const page = pageQuery
    .where(where)
    .orderBy(...order)
    .limit(filter.limit)
    .offset(filter.offset)
    .as("page");
  const profile = newestProfile(db);
  const rows = db
    .select({
      id: applications.id,
      registrationNumber: applications.registrationNumber,
      schoolKey: schools.key,
      childName: field(profile, "childFullName"),
      guardianName: field(profile, "guardianName"),
      guardianPhone: field(profile, "guardianPhone"),
      stage: applications.stage,
      stageChangedAt: applications.stageChangedAt,
      lastCommand: applicationEvents.command,
      lastActorType: applicationEvents.actorType,
      lastAt: applicationEvents.createdAt,
    })
    .from(page)
    .innerJoin(applications, eq(applications.id, page.pageId))
    .innerJoin(schools, eq(schools.id, applications.schoolId))
    .innerJoinLateral(profile, sql`true`)
    .innerJoin(
      applicationEvents,
      and(
        eq(applicationEvents.applicationId, applications.id),
        eq(applicationEvents.seq, applications.lastEventSeq),
      ),
    )
    .orderBy(...order);

  const [found, [counted]] = await Promise.all([rows, totalQuery.where(where)]);
  return { rows: found, total: counted!.total };
}

const waiting = inArray(applications.stage, [...COMMITTEE_STAGES]);

// Monday 00:00 in Samarinda, whatever zone the server runs in.
const startOfWeek = sql`date_trunc('week', now() at time zone 'Asia/Makassar') at time zone 'Asia/Makassar'`;

/** One row per school that has applications. Each application's events are read once. */
export async function countForDashboard(db: Database, schoolKeys: readonly SchoolKey[]) {
  const { command, payload, seq } = applicationEvents;
  const history = db
    .select({
      paid: sql<boolean>`coalesce(bool_or(${command} = 'APPROVE_PAYMENT'), false)`.as("paid"),
      decided: sql<boolean>`coalesce(bool_or(${command} = 'DECIDE'), false)`.as("decided"),
      // The committee knows its decisions before results day, so "accepted"
      // counts the newest decision, not a published result.
      decision: sql<
        string | null
      >`(array_agg(${payload}->>'decision' order by ${seq} desc) filter (where ${command} = 'DECIDE'))[1]`.as(
        "decision",
      ),
    })
    .from(applicationEvents)
    .where(eq(applicationEvents.applicationId, applications.id))
    .as("history");

  return db
    .select({
      schoolKey: schools.key,
      total: count(),
      newThisWeek: sql<number>`count(*) filter (where ${applications.createdAt} >= ${startOfWeek})::int`,
      paid: sql<number>`count(*) filter (where ${history.paid})::int`,
      needsCommittee: sql<number>`count(*) filter (where ${waiting})::int`,
      oldestWaitingSince: sql<
        string | null
      >`min(${applications.stageChangedAt}) filter (where ${waiting})`,
      // A child who withdrew after the decision will not join, so neither count keeps them.
      decided: sql<number>`count(*) filter (where ${history.decided} and ${applications.stage} <> 'WITHDRAWN')::int`,
      accepted: sql<number>`count(*) filter (where ${history.decision} = 'ACCEPTED' and ${applications.stage} <> 'WITHDRAWN')::int`,
    })
    .from(applications)
    .innerJoin(schools, eq(schools.id, applications.schoolId))
    .innerJoinLateral(history, sql`true`)
    .where(inScope(schoolKeys))
    .groupBy(schools.key);
}

/** Newest first, across the given schools. */
export async function listRecentEvents(
  db: Database,
  schoolKeys: readonly SchoolKey[],
  limit: number,
) {
  const profile = newestProfile(db);
  return db
    .select({
      applicationId: applications.id,
      schoolKey: schools.key,
      childName: field(profile, "childFullName"),
      guardianName: field(profile, "guardianName"),
      staffName: staffUsers.name,
      command: applicationEvents.command,
      actorType: applicationEvents.actorType,
      payload: applicationEvents.payload,
      createdAt: applicationEvents.createdAt,
    })
    .from(applicationEvents)
    .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
    .innerJoin(schools, eq(schools.id, applications.schoolId))
    .innerJoinLateral(profile, sql`true`)
    .leftJoin(staffUsers, staffActor(applicationEvents.actorType, applicationEvents.actorId))
    .where(inScope(schoolKeys))
    .orderBy(desc(applicationEvents.createdAt), desc(applicationEvents.id))
    .limit(limit);
}

/** Null when the application is not in the caller's schools or the current cycle. */
export async function findCommitteeApplication(
  db: Database,
  schoolKeys: readonly SchoolKey[],
  applicationId: string,
) {
  const profile = newestProfile(db);
  const rows = await db
    .select({
      id: applications.id,
      registrationNumber: applications.registrationNumber,
      schoolKey: schools.key,
      stage: applications.stage,
      stageChangedAt: applications.stageChangedAt,
      lastEventSeq: applications.lastEventSeq,
      profile: profile.data,
      accountEmail: user.email,
    })
    .from(applications)
    .innerJoin(schools, eq(schools.id, applications.schoolId))
    .innerJoinLateral(profile, sql`true`)
    .innerJoin(user, eq(user.id, applications.createdByUserId))
    .where(and(eq(applications.id, applicationId), inScope(schoolKeys)))
    .limit(1);
  return rows[0] ?? null;
}

/** Answers only whether the caller may see it, for a write that needs nothing else. */
export async function isInCommitteeScope(
  db: Database,
  schoolKeys: readonly SchoolKey[],
  applicationId: string,
) {
  const rows = await db
    .select({ id: applications.id })
    .from(applications)
    .innerJoin(schools, eq(schools.id, applications.schoolId))
    .where(and(eq(applications.id, applicationId), inScope(schoolKeys)))
    .limit(1);
  return rows.length > 0;
}

export async function listEventsWithActors(db: Database, applicationId: string) {
  return db
    .select({
      seq: applicationEvents.seq,
      command: applicationEvents.command,
      fromStage: applicationEvents.fromStage,
      toStage: applicationEvents.toStage,
      actorType: applicationEvents.actorType,
      staffName: staffUsers.name,
      familyVisible: applicationEvents.familyVisible,
      payload: applicationEvents.payload,
      createdAt: applicationEvents.createdAt,
    })
    .from(applicationEvents)
    .leftJoin(staffUsers, staffActor(applicationEvents.actorType, applicationEvents.actorId))
    .where(eq(applicationEvents.applicationId, applicationId))
    .orderBy(desc(applicationEvents.seq));
}

/**
 * Newest first. The log keeps every visit, but a child opened hundreds of times
 * would bury its own history, so a staff member's views fold into one row per
 * day, at their newest view that day. Every other action stays one row each,
 * grouped by its own id. The day is Samarinda's, like every other date here.
 */
export async function listAuditRows(db: Database, applicationId: string) {
  const perRow = sql`${auditLogs.id}::text`;
  const perDay = sql`(${auditLogs.createdAt} at time zone 'Asia/Makassar')::date::text`;
  const folded = db
    .select({
      action: auditLogs.action,
      actorType: auditLogs.actorType,
      actorId: auditLogs.actorId,
      createdAt: sql`max(${auditLogs.createdAt})`.mapWith(auditLogs.createdAt).as("folded_at"),
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, "application"),
        eq(auditLogs.entityId, applicationId),
        inArray(auditLogs.action, [...AUDIT_ACTIONS]),
      ),
    )
    .groupBy(
      auditLogs.action,
      auditLogs.actorType,
      auditLogs.actorId,
      sql`case when ${auditLogs.action} = ${VIEWED_ACTION} then ${perDay} else ${perRow} end`,
    )
    .as("folded");

  return db
    .select({
      action: folded.action,
      actorType: folded.actorType,
      staffName: staffUsers.name,
      familyHasAccess: sql<boolean>`exists (
        select 1 from ${applicationAccess}
        where ${applicationAccess.applicationId} = ${applicationId}
          and ${applicationAccess.userId} = ${folded.actorId}
      )`,
      createdAt: folded.createdAt,
    })
    .from(folded)
    .leftJoin(staffUsers, staffActor(folded.actorType, folded.actorId))
    .orderBy(desc(folded.createdAt), desc(folded.actorId));
}
