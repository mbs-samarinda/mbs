import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

import {
  ApplicationStage,
  AppliedCommand,
  SchoolKey,
  type ActorType,
  type ApplicantProfileInput,
  type ApplicationCommand,
  type CommandPayload,
} from "@mbs/api-contract";
import { createDatabase, createSessionConnection, schema, type Database } from "@mbs/db";
import { APPLICATION_STAGES, GUARDIAN_RELATIONS, SCHOOL_KEYS } from "@mbs/school-config";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { loadConfig } from "../src/config/env.ts";
import { listSchoolKeysTakingPart } from "../src/modules/admission/repository.ts";
import {
  createAdmissionCycle,
  listAdmissionCycles,
  setAdmissionCycleStatus,
  updateAdmissionCycle,
  upsertSchoolAdmissionSetting,
} from "../src/modules/admission/service.ts";
import {
  applyCommand,
  saveProfile,
  submitApplication,
  type Actor,
} from "../src/modules/application/service.ts";
import { TRANSITIONS, isEndStage } from "../src/modules/application/stages.ts";
import { createStaffAuth, sessionCookie } from "../src/modules/auth/auth.ts";
import type { StaffContext } from "../src/modules/auth/authorization.ts";
import { ensureBootstrapAdministrator } from "../src/modules/staff/bootstrap.ts";

const DAY = 86_400_000;

const SIM_STAFF: StaffContext = {
  id: "00000000-0000-4000-8000-000000005157",
  name: "ppdb-sim",
  role: "ADMINISTRATOR",
  schoolKeys: [...SCHOOL_KEYS],
  authUserId: "ppdb-sim",
};

const SAMPLE_PAYLOADS: { [C in AppliedCommand]: CommandPayload<C> } = {
  SUBMIT: { payloadVersion: 1 },
  UPLOAD_PAYMENT_PROOF: { payloadVersion: 1 },
  APPROVE_PAYMENT: { payloadVersion: 1 },
  REJECT_PAYMENT: { payloadVersion: 1, reason: "Bukti transfer tidak terbaca." },
  SUBMIT_DOCUMENTS: { payloadVersion: 1 },
  REQUEST_DOCUMENT_FIX: { payloadVersion: 1, reason: "Foto kartu keluarga buram." },
  VERIFY_DOCUMENTS: { payloadVersion: 1 },
  ADVANCE_TO_INTERVIEW: { payloadVersion: 1 },
  STOP_AT_SCREENING: { payloadVersion: 1, reason: "Belum memenuhi syarat usia." },
  SCHEDULE_INTERVIEW: { payloadVersion: 1 },
  RESCHEDULE_INTERVIEW: { payloadVersion: 1 },
  RECORD_ATTENDED: { payloadVersion: 1 },
  RECORD_NO_SHOW: { payloadVersion: 1 },
  DECIDE: { payloadVersion: 1, decision: "ACCEPTED" },
  PUBLISH_ACCEPTED: { payloadVersion: 1 },
  PUBLISH_NOT_ACCEPTED: { payloadVersion: 1 },
  SUBMIT_REREGISTRATION: { payloadVersion: 1 },
  REQUEST_REREGISTRATION_FIX: {
    payloadVersion: 1,
    reason: "Surat pernyataan belum ditandatangani.",
  },
  CONFIRM_ENROLLMENT: { payloadVersion: 1 },
  WITHDRAW: { payloadVersion: 1 },
  ADD_NOTE: { payloadVersion: 1, note: "Catatan dari simulator." },
  CHANGE_INTERVIEW_MODE: { payloadVersion: 1, mode: "ONLINE" },
};

const FIRST_NAMES = ["Aisyah", "Fatimah", "Rizki", "Hasan", "Nadia", "Umar", "Zahra", "Bilal"];
const LAST_NAMES = ["Putri", "Ramadhani", "Pratama", "Saputra", "Hidayat", "Lestari"];

const timings = new Map<string, number[]>();

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await run();
  } finally {
    const list = timings.get(label) ?? [];
    list.push(performance.now() - started);
    timings.set(label, list);
  }
}

function print(line: string) {
  process.stdout.write(`${line}\n`);
}

function digest(...parts: (string | number)[]) {
  return createHash("sha256").update(parts.join(":")).digest();
}

function pick(list: readonly string[], hash: Buffer, byte: number) {
  return list[hash[byte]! % list.length] ?? "";
}

function nikFor(seed: string, index: number) {
  return (digest(seed, index, "nik").readBigUInt64BE() % 10n ** 16n).toString().padStart(16, "0");
}

function profileFor(seed: string, index: number, nik: string, edit = 0): ApplicantProfileInput {
  const hash = digest(seed, index, "profile");
  return {
    childFullName: `${pick(FIRST_NAMES, hash, 0)} ${pick(LAST_NAMES, hash, 1)}`,
    nik,
    birthDate: `2014-0${(hash[2]! % 9) + 1}-1${hash[3]! % 10}`,
    sex: hash[4]! % 2 === 0 ? "FEMALE" : "MALE",
    schoolOfOrigin: `SD Negeri ${(hash[5]! % 40) + 1} Samarinda`,
    guardianName: pick(FIRST_NAMES, hash, 6),
    guardianRelation: GUARDIAN_RELATIONS[hash[11]! % GUARDIAN_RELATIONS.length]!,
    guardianPhone: `0812${String(hash.readUInt32BE(7) % 10_000_000).padStart(7, "0")}${edit}`,
  };
}

function pathTo(target: ApplicationStage): AppliedCommand[] | null {
  const moves = AppliedCommand.options.flatMap((command) => {
    const row = TRANSITIONS[command];
    if (row.from === "NONE" || row.to === "SAME") return [];
    const from =
      row.from === "ANY_OPEN" ? APPLICATION_STAGES.filter((s) => !isEndStage(s)) : row.from;
    return from
      .filter((stage) => stage !== row.to)
      .map((stage) => ({ stage, command, to: row.to }));
  });

  const previous = new Map<
    ApplicationStage,
    { stage: ApplicationStage; command: AppliedCommand }
  >();
  const queue: ApplicationStage[] = ["PAYMENT_DUE"];
  const seen = new Set<ApplicationStage>(queue);
  while (queue.length > 0) {
    const stage = queue.shift()!;
    if (stage === target) break;
    for (const move of moves.filter((m) => m.stage === stage && !seen.has(m.to))) {
      seen.add(move.to);
      previous.set(move.to, { stage, command: move.command });
      queue.push(move.to);
    }
  }
  if (!seen.has(target)) return null;

  const path: AppliedCommand[] = [];
  for (let stage = target; stage !== "PAYMENT_DUE";) {
    const step = previous.get(stage)!;
    path.unshift(step.command);
    stage = step.stage;
  }
  return path;
}

function actorFor(command: ApplicationCommand, familyUserId: string, as?: ActorType): Actor {
  const type = as ?? TRANSITIONS[command].actors[0];
  if (type === "FAMILY") return { type, userId: familyUserId };
  if (type === "STAFF") return { type, staff: SIM_STAFF };
  return { type: "SYSTEM", job: "ppdb-sim" };
}

async function cycleFor(db: Database, seed: string) {
  const [earlier] = await db
    .select({ cycleId: schema.applications.admissionCycleId })
    .from(schema.applicationEvents)
    .innerJoin(
      schema.applications,
      eq(schema.applications.id, schema.applicationEvents.applicationId),
    )
    .where(
      and(
        eq(schema.applicationEvents.actorId, simUserId(seed, 0)),
        eq(schema.applicationEvents.idempotencyKey, stepKey(seed, 0, 1)),
      ),
    );
  return earlier?.cycleId ?? openCycle(db);
}

function simUserId(seed: string, index: number) {
  return `ppdb-sim-${seed}-${index}`;
}

function stepKey(seed: string, index: number, step: string | number) {
  return `ppdb-sim:${seed}:${index}:${step}`;
}

async function openCycle(db: Database) {
  const [existing] = await db
    .select()
    .from(schema.admissionCycles)
    .where(eq(schema.admissionCycles.status, "OPEN"));
  if (existing) {
    const now = Date.now();
    if (
      now < existing.registrationOpenAt.getTime() ||
      now >= existing.registrationCloseAt.getTime()
    ) {
      throw new Error(`The open cycle "${existing.name}" is outside its registration window.`);
    }
    return existing.id;
  }

  const cycle = await createAdmissionCycle(db, SIM_STAFF, {
    name: "PPDB simulasi",
    registrationOpenAt: new Date(Date.now() - DAY).toISOString(),
    registrationCloseAt: new Date(Date.now() + 30 * DAY).toISOString(),
    resultPublishAt: new Date(Date.now() + 60 * DAY).toISOString(),
    defaultFee: 250_000,
  });
  await setAdmissionCycleStatus(db, SIM_STAFF, { cycleId: cycle.id, status: "OPEN" });
  print(`created open cycle "${cycle.name}" ${cycle.id}`);
  return cycle.id;
}

const CycleState = z.enum(["open", "upcoming", "closed", "none"]);

/**
 * Makes the one cycle families see match a state, whatever was there. Cycles only
 * move forward, so one that has gone too far is archived and a new one made.
 */
async function setCycle(db: Database, state: z.infer<typeof CycleState>, args: Args) {
  const setStatus = (cycleId: string, status: "OPEN" | "CLOSED" | "ARCHIVED") =>
    setAdmissionCycleStatus(db, SIM_STAFF, { cycleId, status });
  const cycles = await listAdmissionCycles(db);
  const existing = cycles.find(({ status }) => status === "OPEN");

  for (const cycle of cycles) {
    if (cycle.status === "CLOSED") {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await setStatus(cycle.id, "ARCHIVED");
    }
  }
  if (state === "none") {
    if (existing) {
      await setStatus(existing.id, "CLOSED");
      await setStatus(existing.id, "ARCHIVED");
    }
    print("cycle none");
    return;
  }

  const now = Date.now();
  const day = (days: number) => new Date(now + days * DAY).toISOString();
  const values = {
    name: "PPDB 2027/2028",
    registrationOpenAt: state === "upcoming" ? day(7) : day(-30),
    registrationCloseAt: state === "closed" ? day(-1) : day(60),
    resultPublishAt: day(90),
    defaultFee: args.fee ?? 250_000,
  };
  const cycleId = existing?.id ?? (await createAdmissionCycle(db, SIM_STAFF, values)).id;
  await updateAdmissionCycle(db, SIM_STAFF, { cycleId, ...values });
  if (!existing) await setStatus(cycleId, "OPEN");
  for (const schoolKey of SCHOOL_KEYS) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    await upsertSchoolAdmissionSetting(db, SIM_STAFF, {
      cycleId,
      schoolKey,
      isEnabled: !args.off.includes(schoolKey),
      feeOverride: null,
      acceptedInstructions: null,
      rejectedInstructions: null,
      documents: [
        { type: "KARTU_KELUARGA", required: true },
        { type: "AKTA_KELAHIRAN", required: true },
        { type: "IJAZAH", required: false },
      ],
    });
  }
  if (state === "closed") await setStatus(cycleId, "CLOSED");
  print(`cycle ${state} ${cycleId}${args.off.length > 0 ? ` without ${args.off.join(", ")}` : ""}`);
}

async function takingPart(db: Database, cycleId: string) {
  const keys = await listSchoolKeysTakingPart(db, cycleId);
  return SCHOOL_KEYS.filter((key) => keys.includes(key));
}

async function ensureFamilyUser(db: Database, id: string) {
  await db
    .insert(schema.user)
    .values({ id, name: id, email: `${id}@ppdb-sim.invalid`, emailVerified: true })
    .onConflictDoNothing();
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  return `${error.constructor.name}: ${error.message}`;
}

async function walk(db: Database, args: Args) {
  const target = args.to;
  const path = pathTo(target);
  if (!path) throw new Error(`No route from PAYMENT_DUE to ${target}.`);

  const cycleId = await cycleFor(db, args.seed);
  const schools = args.schools ?? (await takingPart(db, cycleId));
  if (schools.length === 0) throw new Error("No school takes part in the open cycle.");
  let written = 0;
  let replayed = 0;
  let failed = 0;
  const started = performance.now();

  for (let index = 0; index < args.count; index += 1) {
    const schoolKey = schools[index % schools.length]!;
    const userId = simUserId(args.seed, index);
    const nik = args.nik ?? nikFor(args.seed, index);
    const key = (step: string | number) => stepKey(args.seed, index, step);

    try {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await ensureFamilyUser(db, userId);
      // oxlint-disable-next-line eslint/no-await-in-loop
      const submitted = await timed("SUBMIT", () =>
        submitApplication(
          db,
          {
            cycleId,
            schoolKey,
            userId,
            profile: profileFor(args.seed, index, nik),
            idempotencyKey: key(1),
          },
          outbox,
        ),
      );
      let newRows = submitted.replayed ? 0 : 1;
      let replayedRows = submitted.replayed ? 1 : 0;
      let seq = submitted.application.lastEventSeq;
      const record = (result: { replayed: boolean; event: { seq: number } }) => {
        if (result.replayed) {
          replayedRows += 1;
        } else {
          newRows += 1;
          seq = result.event.seq;
        }
      };

      for (let edit = 1; edit <= args.profileEdits; edit += 1) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        const saved = await timed("EDIT_PROFILE", () =>
          saveProfile(
            db,
            {
              applicationId: submitted.application.id,
              actor: { type: "FAMILY", userId },
              profile: profileFor(args.seed, index, nik, edit),
              expectedSeq: seq,
              idempotencyKey: key(`edit-${edit}`),
            },
            outbox,
          ),
        );
        record(saved);
      }

      for (const [step, command] of path.entries()) {
        const payload =
          command === "DECIDE" && path[step + 1] === "PUBLISH_NOT_ACCEPTED"
            ? { payloadVersion: 1, decision: "NOT_ACCEPTED" }
            : SAMPLE_PAYLOADS[command];
        // oxlint-disable-next-line eslint/no-await-in-loop
        const result = await timed(command, () =>
          applyCommand(
            db,
            {
              command,
              payload,
              applicationId: submitted.application.id,
              actor: actorFor(command, userId),
              expectedSeq: seq,
              idempotencyKey: key(step + 2),
            },
            outbox,
          ),
        );
        record(result);
      }

      written += newRows;
      replayed += replayedRows;
      print(`${submitted.application.registrationNumber}  ${target}  ${newRows} new steps`);
    } catch (error) {
      failed += 1;
      print(`#${index} ${schoolKey} ERROR ${describeError(error)}`);
    }
  }

  const seconds = ((performance.now() - started) / 1000).toFixed(2);
  print(
    `${args.count - failed} applications, ${written} steps written, ${replayed} replayed, ${failed} failed, seed ${args.seed}, ${seconds}s`,
  );
  if (args.timings) printTimings();
  if (failed > 0) process.exitCode = 1;
}

async function applyOne(
  db: Database,
  args: Args,
  registrationNumber: string,
  command: AppliedCommand,
) {
  const [row] = await db
    .select({ application: schema.applications })
    .from(schema.applications)
    .innerJoin(
      schema.admissionCycles,
      eq(schema.admissionCycles.id, schema.applications.admissionCycleId),
    )
    .where(
      and(
        eq(schema.admissionCycles.status, "OPEN"),
        eq(schema.applications.registrationNumber, registrationNumber),
      ),
    );
  if (!row) throw new Error(`No application ${registrationNumber} in the open cycle.`);
  const { application } = row;

  const payload = { ...SAMPLE_PAYLOADS[command], ...args.payload };
  const result = await timed(command, () =>
    applyCommand(
      db,
      {
        command,
        payload,
        applicationId: application.id,
        actor: actorFor(command, application.createdByUserId),
        expectedSeq: args.expectedSeq ?? application.lastEventSeq,
        idempotencyKey: args.key,
      },
      outbox,
    ),
  );
  const { event } = result;
  print(
    `${registrationNumber}  ${event.command}  seq ${event.seq}  ${event.fromStage} -> ${event.toStage}${result.replayed ? "  (replayed)" : ""}`,
  );
}

async function staffSession(db: Database, rawEmail: string) {
  const email = z.email().parse(rawEmail.trim().toLowerCase());
  const config = loadConfig();
  await ensureBootstrapAdministrator(db, email);

  const auth = createStaffAuth(db, config, {});
  const context = await auth.$context;
  const user =
    (await context.internalAdapter.findUserByEmail(email))?.user ??
    (
      await context.internalAdapter.createOAuthUser(
        { email, name: email, emailVerified: true },
        { providerId: "google", accountId: `ppdb-sim-${email}` },
      )
    ).user;

  print(`host: ${new URL(config.auth.adminAppUrl).host}`);
  print(`cookie: ${await sessionCookie(auth, user.id)}`);
}

function printTimings() {
  print("command                      count    p95 ms");
  for (const [label, list] of timings) {
    const sorted = list.toSorted((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
    print(`${label.padEnd(28)} ${String(list.length).padStart(5)} ${p95.toFixed(2).padStart(9)}`);
  }
}

type Args = {
  count: number;
  to: ApplicationStage;
  seed: string;
  schools: SchoolKey[] | null;
  nik: string | null;
  profileEdits: number;
  timings: boolean;
  expectedSeq: number | null;
  key: string | null;
  payload: Record<string, unknown>;
  staffSession: string | null;
  fee: number | null;
  off: SchoolKey[];
};

function parse(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      count: { type: "string", default: "1" },
      to: { type: "string", default: "PAYMENT_DUE" },
      seed: { type: "string" },
      school: { type: "string" },
      nik: { type: "string" },
      "profile-edits": { type: "string", default: "0" },
      timings: { type: "boolean", default: false },
      "expected-seq": { type: "string" },
      key: { type: "string" },
      payload: { type: "string" },
      "staff-session": { type: "string" },
      fee: { type: "string" },
      off: { type: "string" },
    },
  });

  const args: Args = {
    count: z.coerce.number().int().min(1).parse(values.count),
    to: ApplicationStage.parse(values.to),
    seed: values.seed ?? randomUUID().slice(0, 8),
    schools: values.school ? z.array(SchoolKey).parse(values.school.split(",")) : null,
    nik: values.nik ?? null,
    profileEdits: z.coerce.number().int().min(0).parse(values["profile-edits"]),
    timings: values.timings,
    expectedSeq: values["expected-seq"]
      ? z.coerce.number().int().parse(values["expected-seq"])
      : null,
    key: values.key ?? null,
    payload: values.payload
      ? z.record(z.string(), z.unknown()).parse(JSON.parse(values.payload))
      : {},
    staffSession: values["staff-session"] ?? null,
    fee: values.fee ? z.coerce.number().int().min(0).parse(values.fee) : null,
    off: values.off ? z.array(SchoolKey).parse(values.off.split(",")) : [],
  };
  return { args, positionals };
}

// The password check covers what the host cannot: a tunnel makes production
// look like localhost, but production's password is not one of these. It proves
// nothing on a server that takes any password, as Postgres does from inside its
// own container, so a made-up one has to be refused.
async function assertLocalDatabase(url: string) {
  const { hostname, password } = new URL(url);
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  const isDevPassword = password === "mbs_local_dev" || password === "mbs_verify";
  if (process.env.NODE_ENV === "production" || !isLocal || !isDevPassword) {
    throw new Error(
      "ppdb-sim runs only against a local database with a development password, never production.",
    );
  }

  const wrong = new URL(url);
  wrong.password = randomUUID();
  const connection = createSessionConnection(wrong.toString());
  const refusal = await connection`select 1`.then(
    () => null,
    (error: unknown) => error,
  );
  await connection.end({ timeout: 0 });
  if (refusal === null) {
    throw new Error("ppdb-sim needs a database that checks passwords. This one accepts any.");
  }
  if (!(refusal instanceof Error && "code" in refusal && refusal.code === "28P01")) throw refusal;
}

const { args, positionals } = parse(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set.");
const db = createDatabase(databaseUrl);
const outbox = { familyAppUrl: process.env.FAMILY_APP_URL ?? "" };

try {
  await assertLocalDatabase(databaseUrl);
  if (args.staffSession) {
    await staffSession(db, args.staffSession);
  } else if (positionals[0] === "cycle") {
    await setCycle(db, CycleState.parse(positionals[1]), args);
  } else if (!outbox.familyAppUrl) {
    throw new Error("FAMILY_APP_URL is not set. Every step queues an email that links to it.");
  } else if (positionals[0] === "apply") {
    const [, registrationNumber, command] = positionals;
    if (!registrationNumber)
      throw new Error("Usage: ppdb-sim apply <REGISTRATION-NUMBER> <COMMAND>");
    await applyOne(db, args, registrationNumber, AppliedCommand.parse(command));
  } else {
    await walk(db, args);
  }
} catch (error) {
  print(`ERROR ${describeError(error)}`);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
