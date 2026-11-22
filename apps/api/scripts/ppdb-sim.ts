/**
 * Seeds PPDB data by calling the real domain functions, so every row it writes
 * went through the stage table, the locks and the idempotency checks.
 *
 *   pnpm ppdb-sim --count 20 --to ENROLLED [--seed demo] [--school smp,sma]
 *                 [--nik 6472010101010001] [--profile-edits 3] [--timings]
 *   pnpm ppdb-sim apply SMP-0001 APPROVE_PAYMENT [--expected-seq 2] [--key k]
 *                 [--payload '{"reason":"..."}']
 *
 * The same `--seed` makes the same NIKs, accounts and idempotency keys, so a
 * second run replays every step and writes nothing new. Reads DATABASE_URL,
 * falling back to apps/api/.env.
 */
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

import {
  ApplicationCommand,
  ApplicationStage,
  SchoolKey,
  type ActorType,
  type ApplicantProfileInput,
  type CommandInput,
  type CommandPayload,
} from "@mbs/api-contract";
import { createDatabase, schema, type Database } from "@mbs/db";
import { APPLICATION_COMMANDS, APPLICATION_STAGES, SCHOOL_KEYS } from "@mbs/school-config";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createAdmissionCycle, setAdmissionCycleStatus } from "../src/modules/admission/service.ts";
import {
  applyCommand,
  saveProfile,
  submitApplication,
  type Actor,
} from "../src/modules/application/service.ts";
import { TRANSITIONS, isEndStage } from "../src/modules/application/stages.ts";
import type { StaffContext } from "../src/modules/auth/authorization.ts";

const DAY = 86_400_000;

// Not a real staff row: event actor ids are plain text, and a staff profile
// here would show up in the committee's staff list.
const SIM_STAFF: StaffContext = {
  id: "00000000-0000-4000-8000-000000005157",
  name: "ppdb-sim",
  role: "ADMINISTRATOR",
  schoolKeys: [...SCHOOL_KEYS],
  authUserId: "ppdb-sim",
};

/** A valid payload for every command. The compiler checks none is missing. */
const SAMPLE_PAYLOADS: { [C in ApplicationCommand]: CommandPayload<C> } = {
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
    guardianRelation: "Orang tua",
    // Each edit changes the phone, so every save is a real change.
    guardianPhone: `0812${String(hash.readUInt32BE(7) % 10_000_000).padStart(7, "0")}${edit}`,
  };
}

/**
 * The shortest walk from PAYMENT_DUE to `target` over the stage table, so a
 * new row in TRANSITIONS is a new route here without touching this file.
 */
function pathTo(target: ApplicationStage): ApplicationCommand[] | null {
  const moves = APPLICATION_COMMANDS.flatMap((command) => {
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
    { stage: ApplicationStage; command: ApplicationCommand }
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

  const path: ApplicationCommand[] = [];
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

function commandInput(command: ApplicationCommand, payload: unknown): CommandInput {
  // TypeScript cannot pair a command chosen at run time with its payload type.
  // The domain parses the payload against the command's schema before it
  // writes anything, so a wrong pairing is refused there, never stored.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { command, payload } as CommandInput;
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

  const cycleId = await openCycle(db);
  let written = 0;
  let replayed = 0;
  let failed = 0;
  const started = performance.now();

  for (let index = 0; index < args.count; index += 1) {
    const schoolKey = args.schools[index % args.schools.length]!;
    const userId = `ppdb-sim-${args.seed}-${index}`;
    const nik = args.nik ?? nikFor(args.seed, index);
    const key = (step: string | number) => `ppdb-sim:${args.seed}:${index}:${step}`;

    try {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await ensureFamilyUser(db, userId);
      // oxlint-disable-next-line eslint/no-await-in-loop
      const submitted = await timed("SUBMIT", () =>
        submitApplication(db, {
          cycleId,
          schoolKey,
          userId,
          profile: profileFor(args.seed, index, nik),
          idempotencyKey: key(1),
        }),
      );
      let newRows = submitted.replayed ? 0 : 1;
      let seen = 1;

      for (let edit = 1; edit <= args.profileEdits; edit += 1) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        const saved = await timed("SAVE_PROFILE", () =>
          saveProfile(db, {
            applicationId: submitted.application.id,
            userId,
            profile: profileFor(args.seed, index, nik, edit),
            expectedVersion: edit,
          }),
        );
        newRows += saved.replayed ? 0 : 1;
        seen += 1;
      }

      for (const [step, command] of path.entries()) {
        const payload =
          command === "DECIDE" && path[step + 1] === "PUBLISH_NOT_ACCEPTED"
            ? { payloadVersion: 1, decision: "NOT_ACCEPTED" }
            : SAMPLE_PAYLOADS[command];
        // oxlint-disable-next-line eslint/no-await-in-loop
        const result = await timed(command, () =>
          applyCommand(db, {
            ...commandInput(command, payload),
            applicationId: submitted.application.id,
            actor: actorFor(command, userId),
            expectedSeq: step + 1,
            idempotencyKey: key(step + 2),
          }),
        );
        newRows += result.replayed ? 0 : 1;
        seen += 1;
      }

      written += newRows;
      replayed += seen - newRows;
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
  command: ApplicationCommand,
) {
  const cycleId = await openCycle(db);
  const [application] = await db
    .select()
    .from(schema.applications)
    .where(
      and(
        eq(schema.applications.admissionCycleId, cycleId),
        eq(schema.applications.registrationNumber, registrationNumber),
      ),
    );
  if (!application) throw new Error(`No application ${registrationNumber} in the open cycle.`);

  const payload = { ...SAMPLE_PAYLOADS[command], ...args.payload };
  const result = await timed(command, () =>
    applyCommand(db, {
      ...commandInput(command, payload),
      applicationId: application.id,
      actor: actorFor(command, application.createdByUserId),
      expectedSeq: args.expectedSeq ?? application.lastEventSeq,
      idempotencyKey: args.key,
    }),
  );
  const { event } = result;
  print(
    `${registrationNumber}  ${event.command}  seq ${event.seq}  ${event.fromStage} -> ${event.toStage}${result.replayed ? "  (replayed)" : ""}`,
  );
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
  schools: SchoolKey[];
  nik: string | null;
  profileEdits: number;
  timings: boolean;
  expectedSeq: number | null;
  key: string | null;
  payload: Record<string, unknown>;
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
    },
  });

  const args: Args = {
    count: z.coerce.number().int().min(1).parse(values.count),
    to: ApplicationStage.parse(values.to),
    seed: values.seed ?? randomUUID().slice(0, 8),
    schools: z.array(SchoolKey).parse((values.school ?? SCHOOL_KEYS.join(",")).split(",")),
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
  };
  return { args, positionals };
}

const { args, positionals } = parse(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set.");
const db = createDatabase(databaseUrl);

try {
  if (positionals[0] === "apply") {
    const [, registrationNumber, command] = positionals;
    if (!registrationNumber)
      throw new Error("Usage: ppdb-sim apply <REGISTRATION-NUMBER> <COMMAND>");
    await applyOne(db, args, registrationNumber, ApplicationCommand.parse(command));
  } else {
    await walk(db, args);
  }
} catch (error) {
  print(`ERROR ${describeError(error)}`);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
