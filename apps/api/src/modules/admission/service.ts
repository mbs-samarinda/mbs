import {
  FieldChange,
  SETUP_GAPS,
  type AdmissionCycle,
  type AgreementVersion,
  type CreateCycleInput,
  type CycleChange,
  type CycleField,
  type CycleRef,
  type CycleSetup,
  type CycleStatus,
  type DocumentStage,
  type PublicAdmissionCycle,
  type SaveCycleInput,
  type SchoolKey,
  type SchoolSetup,
  type SetCycleStatusInput,
  type SetupGap,
} from "@mbs/api-contract";
import type { Database, Transaction } from "@mbs/db";
import { SCHOOL_KEYS } from "@mbs/school-config";
import { z } from "zod";

import {
  AnotherCycleOpenError,
  ConflictError,
  isUniqueViolation,
  NotFoundError,
  NotReadyError,
} from "../../errors.ts";
import { appendAuditLog } from "../audit.ts";
import { requireSchoolAccess, type StaffContext } from "../auth/authorization.ts";
import {
  copySchoolSetup,
  findCurrentCycleForSchool,
  findCycleById,
  findCycleForUpdate,
  findOpenCycleOtherThan,
  insertAgreementVersion,
  insertCycle,
  listAgreementVersions,
  listCycleAudit,
  listCycles,
  listDocumentRequirements,
  listNewestAgreements,
  listSchools,
  listSchoolSettings,
  replaceDocumentRequirements,
  updateCycleFields,
  updateCycleStatus,
  upsertSchoolSetting,
} from "./repository.ts";

type Executor = Database | Transaction;

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

  // A school that is not taking part has no cycle to report. Every school is now
  // in every cycle, so without this a disabled school would answer with the
  // cycle anyway and the public page would print "sudah ditutup" over dates and
  // a fee belonging to a registration that school never ran. Saying nothing is
  // the same answer it gave before membership became implicit, and for the same
  // reason `unavailable` is not rendered as closed: a registration that is not
  // happening is not a registration that has ended.
  if (!row.isEnabled) return null;

  // The committee's own screen reads every school's requirements for one cycle,
  // so this reuses that query and keeps the one school's rows rather than adding
  // a second, narrower one. Three schools' worth of rows is a handful.
  const requirements = await listDocumentRequirements(db, row.id, "REGISTRATION");

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
    documents: requirements
      .filter((requirement) => requirement.schoolKey === schoolKey)
      .map(({ type, required }) => ({ type, required })),
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

/** The fields each side panel owns. A save diffs only these, so its audit row names only them. */
const SECTION_FIELDS: Record<SaveCycleInput["section"], readonly CycleField[]> = {
  schedule: ["name", "registrationOpenAt", "registrationCloseAt", "resultPublishAt", "isEnabled"],
  bank: ["bankName", "bankAccountNumber", "bankAccountHolder"],
  fees: ["defaultFee", "fee", "reregistrationFee"],
  documents: ["registrationDocuments", "reregistrationDocuments"],
  messages: ["acceptedInstructions", "rejectedInstructions"],
  agreement: ["agreement"],
};

const HISTORY_LIMIT = 100;

export async function listAdmissionCycles(db: Database): Promise<AdmissionCycle[]> {
  return (await listCycles(db)).map(toCycle);
}

/**
 * A new cycle starts as a copy of the newest one: the bank account, every
 * school's fees, documents and messages. Only the name, dates and default fee
 * are asked, because those always change from year to year.
 */
export async function createAdmissionCycle(
  db: Database,
  actor: StaffContext,
  input: CreateCycleInput,
): Promise<AdmissionCycle> {
  return db.transaction(async (tx) => {
    const [latest] = await listCycles(tx);
    const created = await insertCycle(tx, {
      name: input.name,
      registrationOpenAt: new Date(input.registrationOpenAt),
      registrationCloseAt: new Date(input.registrationCloseAt),
      resultPublishAt: new Date(input.resultPublishAt),
      defaultFee: input.defaultFee,
      bankName: latest?.bankName ?? null,
      bankAccountNumber: latest?.bankAccountNumber ?? null,
      bankAccountHolder: latest?.bankAccountHolder ?? null,
    });
    if (latest) await copySchoolSetup(tx, latest.id, created.id);
    await appendAuditLog(tx, {
      actorType: "STAFF",
      actorId: actor.id,
      action: "cycle.create",
      entityType: "admission_cycles",
      entityId: created.id,
      metadata: { copiedFrom: latest?.id ?? null },
    });

    return toCycle(created);
  });
}

export async function getCycleSetup(
  db: Database,
  actor: StaffContext,
  input: CycleRef,
): Promise<CycleSetup> {
  const cycle = await findCycleById(db, input.cycleId);
  if (!cycle) throw new NotFoundError("No such cycle.");

  const [state, audit] = await Promise.all([
    readSchools(db, cycle),
    listCycleAudit(db, cycle.id, HISTORY_LIMIT),
  ]);

  return {
    cycle: toCycle(cycle),
    schools: state.filter((school) => actor.schoolKeys.includes(school.schoolKey)),
    gaps: gapsOf(cycle, state),
    history: audit.map(toChange),
  };
}

/**
 * Saves one side panel. The before and after are read inside the same
 * transaction, so the audit row holds exactly what this save changed, and a
 * save that changes nothing writes nothing.
 */
export async function saveCycleSection(
  db: Database,
  actor: StaffContext,
  input: SaveCycleInput,
): Promise<CycleSetup> {
  if (input.section !== "bank") {
    input.schools.forEach((school) => requireSchoolAccess(actor, school.schoolKey));
  }

  await db.transaction(async (tx) => {
    const cycle = await findCycleForUpdate(tx, input.cycleId);
    if (!cycle) throw new NotFoundError("No such cycle.");
    requireEditable(cycle.status);

    const before = fieldsOf(cycle, await readSchools(tx, cycle));
    await writeSection(tx, actor, input);
    const saved = (await findCycleById(tx, input.cycleId))!;
    const after = fieldsOf(saved, await readSchools(tx, saved));

    const changes = diff(before, after, SECTION_FIELDS[input.section]);
    if (changes.length === 0) return;
    await appendAuditLog(tx, {
      actorType: "STAFF",
      actorId: actor.id,
      action: `cycle.${input.section}`,
      entityType: "admission_cycles",
      entityId: input.cycleId,
      metadata: { changes },
    });
  });

  return getCycleSetup(db, actor, { cycleId: input.cycleId });
}

async function writeSection(tx: Transaction, actor: StaffContext, input: SaveCycleInput) {
  const schoolIds = new Map((await listSchools(tx)).map((school) => [school.key, school.id]));
  const schoolId = (key: SchoolKey) => {
    const id = schoolIds.get(key);
    if (!id) throw new NotFoundError("Unknown school.");
    return id;
  };

  switch (input.section) {
    case "schedule": {
      await updateCycleFields(tx, input.cycleId, {
        name: input.name,
        registrationOpenAt: new Date(input.registrationOpenAt),
        registrationCloseAt: new Date(input.registrationCloseAt),
        resultPublishAt: new Date(input.resultPublishAt),
      });
      for (const school of input.schools) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        await upsertSchoolSetting(tx, input.cycleId, schoolId(school.schoolKey), {
          isEnabled: school.isEnabled,
        });
      }
      return;
    }
    case "bank": {
      await updateCycleFields(tx, input.cycleId, {
        bankName: input.bank.bankName,
        bankAccountNumber: input.bank.accountNumber,
        bankAccountHolder: input.bank.accountHolder,
      });
      return;
    }
    case "fees": {
      await updateCycleFields(tx, input.cycleId, { defaultFee: input.defaultFee });
      for (const school of input.schools) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        await upsertSchoolSetting(tx, input.cycleId, schoolId(school.schoolKey), {
          feeOverride: school.feeOverride,
          reregistrationFee: school.reregistrationFee,
        });
      }
      return;
    }
    case "documents": {
      for (const school of input.schools) {
        const id = schoolId(school.schoolKey);
        // oxlint-disable-next-line eslint/no-await-in-loop
        await replaceDocumentRequirements(
          tx,
          input.cycleId,
          id,
          "REGISTRATION",
          school.registration,
        );
        // oxlint-disable-next-line eslint/no-await-in-loop
        await replaceDocumentRequirements(
          tx,
          input.cycleId,
          id,
          "REREGISTRATION",
          school.reregistration,
        );
      }
      return;
    }
    case "messages": {
      for (const school of input.schools) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        await upsertSchoolSetting(tx, input.cycleId, schoolId(school.schoolKey), {
          acceptedInstructions: school.acceptedInstructions || null,
          rejectedInstructions: school.rejectedInstructions || null,
        });
      }
      return;
    }
    case "agreement": {
      const newest = new Map(
        (await listNewestAgreements(tx)).map((row) => [row.schoolKey, row.body]),
      );
      for (const school of input.schools) {
        if (newest.get(school.schoolKey) === school.body) continue;
        // oxlint-disable-next-line eslint/no-await-in-loop
        await insertAgreementVersion(tx, {
          schoolId: schoolId(school.schoolKey),
          body: school.body,
          createdByStaffId: actor.id,
        }).catch((error: unknown) => {
          if (isUniqueViolation(error)) {
            throw new ConflictError("Someone saved this agreement at the same time.");
          }
          throw error;
        });
      }
      return;
    }
  }
}

export async function listSchoolAgreementVersions(
  db: Database,
  actor: StaffContext,
  input: { schoolKey: SchoolKey },
): Promise<AgreementVersion[]> {
  requireSchoolAccess(actor, input.schoolKey);
  return (await listAgreementVersions(db, input.schoolKey)).map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Role is checked; school scope cannot be. The cycle is global and carries no
 * school, so an administrator assigned to one school still opens it for every
 * school. That follows from the data model, not from a missing check, and it is
 * why opening checks every school's gaps rather than the caller's.
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

    if (input.status === "OPEN") {
      // Checked first: a second cycle that is also incomplete should hear the
      // reason it can never open now, not a list of things to fill in.
      if (await findOpenCycleOtherThan(tx, input.cycleId)) {
        throw new AnotherCycleOpenError("Another cycle is already open.");
      }
      const blocking = gapsOf(existing, await readSchools(tx, existing)).filter(
        (gap) => SETUP_GAPS[gap.kind].neededToOpen,
      );
      if (blocking.length > 0) throw new NotReadyError(blocking);
    }

    await updateCycleStatus(tx, input.cycleId, input.status).catch((error: unknown) => {
      if (isUniqueViolation(error))
        throw new AnotherCycleOpenError("Another cycle is already open.");
      throw error;
    });
    const changes: FieldChange[] = [
      { field: "status", schoolKey: null, from: existing.status, to: input.status },
    ];
    await appendAuditLog(tx, {
      actorType: "STAFF",
      actorId: actor.id,
      action: "cycle.setStatus",
      entityType: "admission_cycles",
      entityId: input.cycleId,
      metadata: { changes },
    });

    return toCycle((await findCycleById(tx, input.cycleId))!);
  });
}

function requireEditable(status: CycleStatus) {
  if (status === "ARCHIVED") throw new ConflictError("An archived cycle is read-only.");
}

type CycleRow = NonNullable<Awaited<ReturnType<typeof findCycleById>>>;

async function readSchools(db: Executor, cycle: CycleRow): Promise<SchoolSetup[]> {
  const [settings, requirements, agreements] = await Promise.all([
    listSchoolSettings(db, cycle.id),
    listDocumentRequirements(db, cycle.id),
    listNewestAgreements(db),
  ]);
  const documents = (schoolKey: SchoolKey, stage: DocumentStage) =>
    requirements
      .filter((row) => row.schoolKey === schoolKey && row.stage === stage)
      .map(({ type, required }) => ({ type, required }));

  return SCHOOL_KEYS.map((schoolKey) => {
    const row = settings.find((setting) => setting.schoolKey === schoolKey);
    const agreement = agreements.find((version) => version.schoolKey === schoolKey);
    return {
      schoolKey,
      isEnabled: row?.isEnabled ?? true,
      feeOverride: row?.feeOverride ?? null,
      effectiveFee: row?.feeOverride ?? cycle.defaultFee,
      reregistrationFee: row?.reregistrationFee ?? null,
      registrationDocuments: documents(schoolKey, "REGISTRATION"),
      reregistrationDocuments: documents(schoolKey, "REREGISTRATION"),
      acceptedInstructions: row?.acceptedInstructions ?? null,
      rejectedInstructions: row?.rejectedInstructions ?? null,
      agreement: agreement
        ? {
            id: agreement.id,
            version: agreement.version,
            body: agreement.body,
            createdAt: agreement.createdAt.toISOString(),
            createdBy: agreement.createdBy,
          }
        : null,
      agreementVersions: agreement?.versions ?? 0,
    };
  });
}

function gapsOf(cycle: CycleRow, schools: readonly SchoolSetup[]): SetupGap[] {
  const gaps: SetupGap[] = [];
  const cycleGap = (kind: SetupGap["kind"]) => gaps.push({ kind, schoolKey: null });

  const ordered =
    cycle.registrationOpenAt < cycle.registrationCloseAt &&
    cycle.registrationCloseAt < cycle.resultPublishAt;
  if (!ordered) cycleGap("schedule");
  if (!toBank(cycle)) cycleGap("bank");

  for (const school of schools.filter((each) => each.isEnabled)) {
    const schoolGap = (kind: SetupGap["kind"], missing: boolean) => {
      if (missing) gaps.push({ kind, schoolKey: school.schoolKey });
    };
    schoolGap("registrationDocuments", school.registrationDocuments.length === 0);
    schoolGap("reregistrationFee", school.reregistrationFee === null);
    schoolGap("reregistrationDocuments", school.reregistrationDocuments.length === 0);
    schoolGap("acceptedInstructions", !school.acceptedInstructions);
    schoolGap("rejectedInstructions", !school.rejectedInstructions);
    schoolGap("agreement", school.agreement === null);
  }
  return gaps;
}

type FieldValue = Omit<FieldChange, "from" | "to"> & { value: FieldChange["to"] };

const cycleField = (field: CycleField, value: FieldChange["to"]): FieldValue => ({
  field,
  schoolKey: null,
  value,
});

/** The cycle as a flat list of named values, so two snapshots compare field by field. */
function fieldsOf(cycle: CycleRow, schools: readonly SchoolSetup[]): FieldValue[] {
  return [
    cycleField("name", cycle.name),
    cycleField("registrationOpenAt", cycle.registrationOpenAt.toISOString()),
    cycleField("registrationCloseAt", cycle.registrationCloseAt.toISOString()),
    cycleField("resultPublishAt", cycle.resultPublishAt.toISOString()),
    cycleField("defaultFee", cycle.defaultFee),
    cycleField("bankName", cycle.bankName),
    cycleField("bankAccountNumber", cycle.bankAccountNumber),
    cycleField("bankAccountHolder", cycle.bankAccountHolder),
    ...schools.flatMap((school) =>
      (
        [
          ["isEnabled", school.isEnabled],
          ["fee", school.feeOverride],
          ["reregistrationFee", school.reregistrationFee],
          ["registrationDocuments", school.registrationDocuments],
          ["reregistrationDocuments", school.reregistrationDocuments],
          ["acceptedInstructions", school.acceptedInstructions],
          ["rejectedInstructions", school.rejectedInstructions],
          ["agreement", school.agreement?.version ?? null],
        ] as const
      ).map(([field, value]) => ({ field, schoolKey: school.schoolKey, value })),
    ),
  ];
}

function diff(
  before: readonly FieldValue[],
  after: readonly FieldValue[],
  fields: readonly CycleField[],
): FieldChange[] {
  return after.flatMap((next) => {
    if (!fields.includes(next.field)) return [];
    const previous = before.find(
      (entry) => entry.field === next.field && entry.schoolKey === next.schoolKey,
    );
    const from = previous?.value ?? null;
    if (JSON.stringify(from) === JSON.stringify(next.value)) return [];
    return [{ field: next.field, schoolKey: next.schoolKey, from, to: next.value }];
  });
}

const StoredChanges = z.object({ changes: z.array(FieldChange) });
// Rows written before the cycle page existed. Kept readable rather than rewritten.
const LegacyStatus = z.object({ from: z.string(), to: z.string() });

function toChange(row: Awaited<ReturnType<typeof listCycleAudit>>[number]): CycleChange {
  const stored = StoredChanges.safeParse(row.metadata);
  const legacy = LegacyStatus.safeParse(row.metadata);
  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    who: row.who,
    created: row.action === "cycle.create",
    changes: stored.success
      ? stored.data.changes
      : row.action === "cycle.setStatus" && legacy.success
        ? [{ field: "status", schoolKey: null, from: legacy.data.from, to: legacy.data.to }]
        : [],
  };
}

function toBank(row: CycleRow) {
  const { bankName, bankAccountNumber, bankAccountHolder } = row;
  if (!bankName || !bankAccountNumber || !bankAccountHolder) return null;
  return { bankName, accountNumber: bankAccountNumber, accountHolder: bankAccountHolder };
}

function toCycle(row: CycleRow): AdmissionCycle {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    registrationOpenAt: row.registrationOpenAt.toISOString(),
    registrationCloseAt: row.registrationCloseAt.toISOString(),
    resultPublishAt: row.resultPublishAt.toISOString(),
    defaultFee: row.defaultFee,
    bank: toBank(row),
  };
}
