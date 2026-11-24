import { isSchoolKey, type SchoolKey } from "@mbs/school-config";
import { useSyncExternalStore } from "react";

/**
 * The registration form as typed, kept on this device until it is sent. No child
 * data reaches the server before that. One draft, for one account: it goes when
 * the account signs out and when another one signs in.
 */
export type Draft = {
  version: typeof VERSION;
  userId: string;
  /** Made once, so a form that is sent twice is registered once. */
  key: string;
  values: Values;
  /**
   * Set when a submit leaves the device, until the server answers it. The cycle
   * is kept because the same request has to be sent again as it was.
   */
  attempt: { cycleId: string; schoolKey: SchoolKey } | null;
};

const VALUE_NAMES = [
  "schoolKey",
  "childFullName",
  "nik",
  "birthDay",
  "birthMonth",
  "birthYear",
  "sex",
  "schoolOfOrigin",
  "guardianName",
  "guardianRelation",
  "guardianPhone",
] as const;
export type ValueName = (typeof VALUE_NAMES)[number];
export type Values = Record<ValueName, string>;

const VERSION = 1;
const STORAGE_KEY = "mbs:draft";
const SAVE_AFTER_MS = 300;
/** Far above any real answer. It stops a stored value from freezing the page. */
const VALUE_MAX = 2000;

export const EMPTY_VALUES: Values = {
  schoolKey: "",
  childFullName: "",
  nik: "",
  birthDay: "",
  birthMonth: "",
  birthYear: "",
  sex: "",
  schoolOfOrigin: "",
  guardianName: "",
  guardianRelation: "",
  guardianPhone: "",
};

/** `saved` is whether the device kept the last write, so the form never claims more. */
type State = { draft: Draft | null; saved: boolean };

let state: State | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function current(): State {
  state ??= readStored();
  return state;
}

function readStored(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const draft = raw === null ? null : parseDraft(raw);
    if (raw !== null && draft === null) localStorage.removeItem(STORAGE_KEY);
    return { draft, saved: draft !== null };
  } catch {
    return { draft: null, saved: false };
  }
}

function replace(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

function write() {
  clearTimeout(timer);
  timer = undefined;
  const { draft } = current();
  let saved = false;
  try {
    if (draft) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      saved = true;
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Full or blocked. The form goes on from memory and does not claim a save.
  }
  if (saved !== current().saved) replace({ draft, saved });
}

/** Writes what is still waiting. The page may be about to go. */
export function flushDraft() {
  if (timer !== undefined) write();
}

/** This account's draft. Anyone else's is dropped, because this device is now theirs. */
export function draftOf(userId: string): Draft | null {
  const { draft } = current();
  if (draft && draft.userId !== userId) clearDraft();
  return current().draft;
}

/** The draft and whether it is kept, for a component. */
export function useDraft(userId: string): State {
  return useSyncExternalStore(subscribe, () => {
    const now = current();
    return now.draft && now.draft.userId !== userId ? NOTHING : now;
  });
}

const NOTHING: State = { draft: null, saved: false };

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function editDraft(userId: string, changes: Partial<Values>) {
  const draft = draftOf(userId) ?? emptyDraft(userId);
  sent = null;
  replace({ ...current(), draft: { ...draft, values: { ...draft.values, ...changes } } });
  clearTimeout(timer);
  timer = setTimeout(write, SAVE_AFTER_MS);
}

/** Written at once: a crash during the request must not forget it was sent. */
export function setAttempt(userId: string, attempt: Draft["attempt"]) {
  const draft = draftOf(userId);
  if (!draft) return;
  replace({ ...current(), draft: { ...draft, attempt } });
  write();
}

/** What was typed, as a new registration. */
export function renewKey(userId: string) {
  const draft = draftOf(userId);
  if (!draft) return;
  replace({ ...current(), draft: { ...draft, key: crypto.randomUUID(), attempt: null } });
  write();
}

export function clearDraft() {
  replace(NOTHING);
  write();
}

/**
 * What this tab sent last, until it starts another form. The browser's history
 * still holds the form's pages, and they lead here instead of to an empty form.
 */
let sent: string | null = null;

export function draftSent(applicationId: string) {
  sent = applicationId;
  clearDraft();
}

export function lastSent() {
  return sent;
}

/** Whether there is anything worth going back to. A school alone is one tap. */
export function isStarted({ values, attempt }: Draft) {
  return (
    attempt !== null ||
    VALUE_NAMES.some((name) => name !== "schoolKey" && values[name].trim() !== "")
  );
}

function emptyDraft(userId: string): Draft {
  return {
    version: VERSION,
    userId,
    key: crypto.randomUUID(),
    values: EMPTY_VALUES,
    attempt: null,
  };
}

function parseDraft(raw: string): Draft | null {
  const data = record(parseJson(raw));
  if (data.version !== VERSION || !isText(data.userId) || !isUuid(data.key)) return null;

  const stored = record(data.values);
  const values = { ...EMPTY_VALUES };
  for (const name of VALUE_NAMES) {
    const value = stored[name];
    if (!isText(value)) return null;
    values[name] = value;
  }
  if (values.schoolKey !== "" && !isSchoolKey(values.schoolKey)) return null;

  let attempt: Draft["attempt"] = null;
  if (data.attempt !== null) {
    const { cycleId, schoolKey } = record(data.attempt);
    if (!isUuid(cycleId) || !isText(schoolKey) || !isSchoolKey(schoolKey)) return null;
    attempt = { cycleId, schoolKey };
  }
  return { version: VERSION, userId: data.userId, key: data.key, values, attempt };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? { ...value } : {};
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length <= VALUE_MAX;
}

/** The server takes nothing else, and a draft it can only refuse is a dead end. */
function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/.test(value);
}

// `pagehide` alone misses a phone that drops a page in the background.
addEventListener("pagehide", flushDraft);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushDraft();
});
// Another tab wrote. What this one has not written yet stays, and wins.
addEventListener("storage", ({ key }) => {
  if ((key === STORAGE_KEY || key === null) && timer === undefined) replace(readStored());
});
