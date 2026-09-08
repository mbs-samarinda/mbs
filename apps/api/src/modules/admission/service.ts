import type {
  AdmissionCycle,
  CreateCycleInput,
  CycleRef,
  CycleStatus,
  PublicAdmissionCycle,
  SchoolAdmissionSetting,
  SchoolKey,
  SetCycleStatusInput,
  UpdateCycleInput,
  UpsertSchoolSettingInput,
} from "@mbs/api-contract";
import type { Database } from "@mbs/db";

import { ConflictError, NotFoundError } from "../../errors.ts";
import { appendAuditLog } from "../audit.ts";
import { requireSchoolAccess, type StaffContext } from "../auth/authorization.ts";
import {
  findCurrentCycleForSchool,
  findCycleById,
  findCycleForUpdate,
  findSchoolIdByKey,
  insertCycle,
  listCycles,
  listDocumentRequirements,
  listSchoolSettings,
  replaceDocumentRequirements,
  updateCycleFields,
  updateCycleStatus,
  upsertSchoolSetting,
} from "./repository.ts";

/**
 * The public view of the current cycle for one school. The cycle itself is
 * global; the fee and the enabled flag come from the school's settings row.
 */
export async function getCurrentCycle(
  db: Database,
  schoolKey: SchoolKey,
): Promise<PublicAdmissionCycle | null> {
  const row = await findCurrentCycleForSchool(db, schoolKey);
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    registrationOpenAt: row.registrationOpenAt.toISOString(),
    registrationCloseAt: row.registrationCloseAt.toISOString(),
    resultPublishAt: row.resultPublishAt.toISOString(),
    schoolKey,
    isEnabled: row.isEnabled,
    effectiveFee: row.feeOverride ?? row.defaultFee,
  };
}

/**
 * Cycles move one step forward and never back. Reopening a closed cycle or
 * un-archiving one is not a mistake this product should make quietly; if the
 * committee ever needs it, it needs a deliberate operation of its own.
 */
const NEXT_STATUS: Record<CycleStatus, CycleStatus | null> = {
  DRAFT: "OPEN",
  OPEN: "CLOSED",
  CLOSED: "ARCHIVED",
  ARCHIVED: null,
};

export async function listAdmissionCycles(db: Database): Promise<AdmissionCycle[]> {
  return (await listCycles(db)).map(toCycle);
}

export async function createAdmissionCycle(
  db: Database,
  actor: StaffContext,
  input: CreateCycleInput,
): Promise<AdmissionCycle> {
  return db.transaction(async (tx) => {
    const created = await insertCycle(tx, toCycleValues(input));
    await appendAuditLog(tx, {
      actorType: "STAFF",
      actorId: actor.id,
      action: "cycle.create",
      entityType: "admission_cycles",
      entityId: created.id,
      metadata: { name: created.name },
    });

    return toCycle(created);
  });
}

export async function updateAdmissionCycle(
  db: Database,
  actor: StaffContext,
  input: UpdateCycleInput,
): Promise<AdmissionCycle> {
  return db.transaction(async (tx) => {
    const existing = await findCycleForUpdate(tx, input.cycleId);
    if (!existing) throw new NotFoundError("No such cycle.");
    requireEditable(existing.status);

    const updated = await updateCycleFields(tx, input.cycleId, toCycleValues(input));
    await appendAuditLog(tx, {
      actorType: "STAFF",
      actorId: actor.id,
      action: "cycle.update",
      entityType: "admission_cycles",
      entityId: input.cycleId,
      metadata: { name: updated.name },
    });

    return toCycle(updated);
  });
}

/**
 * Role is checked; school scope cannot be. The cycle is global and carries no
 * school, so an administrator assigned to one school still archives it for
 * every school. That follows from the data model, not from a missing check.
 */
export async function setAdmissionCycleStatus(
  db: Database,
  actor: StaffContext,
  input: SetCycleStatusInput,
): Promise<AdmissionCycle> {
  return db.transaction(async (tx) => {
    const existing = await findCycleForUpdate(tx, input.cycleId);
    if (!existing) throw new NotFoundError("No such cycle.");
    if (NEXT_STATUS[existing.status] !== input.status) {
      throw new ConflictError(`A ${existing.status} cycle cannot become ${input.status}.`);
    }

    const updated = await updateCycleStatus(tx, input.cycleId, input.status);
    await appendAuditLog(tx, {
      actorType: "STAFF",
      actorId: actor.id,
      action: "cycle.setStatus",
      entityType: "admission_cycles",
      entityId: input.cycleId,
      metadata: { from: existing.status, to: input.status },
    });

    return toCycle(updated);
  });
}

/**
 * One row per school this administrator holds, whether or not it has joined the
 * cycle yet. A school with no settings row is shown as disabled with nothing
 * configured, because that is exactly what it is — and somebody has to be able
 * to open the page that gives it a row.
 */
export async function listSchoolAdmissionSettings(
  db: Database,
  actor: StaffContext,
  input: CycleRef,
): Promise<SchoolAdmissionSetting[]> {
  const cycle = await readCycle(db, input.cycleId);

  const [settings, requirements] = await Promise.all([
    listSchoolSettings(db, input.cycleId),
    listDocumentRequirements(db, input.cycleId),
  ]);

  return actor.schoolKeys.map((schoolKey) => {
    const row = settings.find((setting) => setting.schoolKey === schoolKey);

    return {
      schoolKey,
      isEnabled: row?.isEnabled ?? false,
      feeOverride: row?.feeOverride ?? null,
      effectiveFee: row?.feeOverride ?? cycle.defaultFee,
      acceptedInstructions: row?.acceptedInstructions ?? null,
      rejectedInstructions: row?.rejectedInstructions ?? null,
      documents: requirements
        .filter((requirement) => requirement.schoolKey === schoolKey)
        .map(({ type, required }) => ({ type, required })),
    };
  });
}

export async function upsertSchoolAdmissionSetting(
  db: Database,
  actor: StaffContext,
  input: UpsertSchoolSettingInput,
): Promise<SchoolAdmissionSetting> {
  requireSchoolAccess(actor, input.schoolKey);

  await db.transaction(async (tx) => {
    const cycle = await findCycleForUpdate(tx, input.cycleId);
    if (!cycle) throw new NotFoundError("No such cycle.");
    requireEditable(cycle.status);

    const schoolId = await findSchoolIdByKey(tx, input.schoolKey);
    if (!schoolId) throw new NotFoundError("Unknown school.");

    await upsertSchoolSetting(tx, {
      admissionCycleId: input.cycleId,
      schoolId,
      isEnabled: input.isEnabled,
      feeOverride: input.feeOverride,
      acceptedInstructions: input.acceptedInstructions,
      rejectedInstructions: input.rejectedInstructions,
    });
    await replaceDocumentRequirements(tx, input.cycleId, schoolId, input.documents);
    await appendAuditLog(tx, {
      actorType: "STAFF",
      actorId: actor.id,
      action: "schoolSettings.upsert",
      entityType: "school_admission_settings",
      entityId: `${input.cycleId}:${schoolId}`,
      metadata: {
        schoolKey: input.schoolKey,
        isEnabled: input.isEnabled,
        feeOverride: input.feeOverride,
      },
    });
  });

  const settings = await listSchoolAdmissionSettings(db, actor, { cycleId: input.cycleId });
  return settings.find((setting) => setting.schoolKey === input.schoolKey)!;
}

/** An archived cycle is history. Nothing inside it changes again. */
function requireEditable(status: CycleStatus) {
  if (status === "ARCHIVED") throw new ConflictError("An archived cycle is read-only.");
}

async function readCycle(db: Database, cycleId: string) {
  const cycle = await findCycleById(db, cycleId);
  if (!cycle) throw new NotFoundError("No such cycle.");
  return cycle;
}

function toCycleValues(input: CreateCycleInput) {
  return {
    name: input.name,
    registrationOpenAt: new Date(input.registrationOpenAt),
    registrationCloseAt: new Date(input.registrationCloseAt),
    resultPublishAt: new Date(input.resultPublishAt),
    defaultFee: input.defaultFee,
  };
}

function toCycle(row: Awaited<ReturnType<typeof listCycles>>[number]): AdmissionCycle {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    registrationOpenAt: row.registrationOpenAt.toISOString(),
    registrationCloseAt: row.registrationCloseAt.toISOString(),
    resultPublishAt: row.resultPublishAt.toISOString(),
    defaultFee: row.defaultFee,
  };
}
