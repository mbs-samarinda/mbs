import { apiFetch, UnreachableError } from "./http.ts";

export type Account = { id: string; email: string };

/** What Better Auth refused, with the code the screen explains. */
export class AuthError extends Error {
  override name = "AuthError";
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;
  readonly body: unknown;

  constructor(
    status: number,
    code: string | null,
    retryAfterSeconds: number | null,
    body: unknown = null,
  ) {
    super(`Sign-in request refused: ${code ?? status}`);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.body = body;
  }
}

/** Plain fetch, not Better Auth's client library, to keep the first load small. */
async function request(path: string, body?: object): Promise<Response> {
  const response = await apiFetch(
    `/api/auth${path}`,
    body && {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (response.ok) return response;
  const data: unknown = await response.json().catch(() => null);
  const retryAfter = Number(response.headers.get("x-retry-after"));
  throw new AuthError(
    response.status,
    stringIn(data, "code"),
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    data,
  );
}

/**
 * The status alone decides. A code is used up by then, so a body cut off on the
 * way must not turn a sign-in that worked into one to try again. It reads as null.
 */
export async function authPost(path: string, body: object): Promise<unknown> {
  const response = await request(path, body);
  return response.json().catch(() => null);
}

async function answerOf(response: Response): Promise<unknown> {
  return response.json().catch((cause: unknown) => {
    throw new UnreachableError("The answer was cut off.", { cause });
  });
}

/** The signed-in account, or null. */
export async function fetchAccount(): Promise<Account | null> {
  return accountIn(await answerOf(await request("/get-session")));
}

/** The account in an answer that carries `user`: a session, or a sign-in. */
export function accountIn(data: unknown): Account | null {
  const user = typeof data === "object" && data !== null && "user" in data ? data.user : null;
  const id = stringIn(user, "id");
  const email = stringIn(user, "email");
  return id === null || email === null ? null : { id, email };
}

export async function signOut() {
  await authPost("/sign-out", {});
}

const LEAVING_MS = 20_000;

/**
 * Sends the browser to Google. Both paths must already be safe return targets;
 * Better Auth checks them against the app's origin too. `chooseAccount` makes
 * Google ask, where it would reuse its only account in silence and refuse the
 * visitor a second time.
 *
 * Resolves when the visitor comes back to this page, or a while after the browser
 * starts to leave. So a button can wait for the new page, which on mobile data
 * takes seconds, and is never left waiting for good.
 */
export async function goToGoogle(options: {
  returnTo: string;
  errorTo: string;
  chooseAccount: boolean;
}) {
  const data = await answerOf(
    await request("/sign-in/social", {
      provider: "google",
      callbackURL: new URL(options.returnTo, location.origin).href,
      errorCallbackURL: new URL(options.errorTo, location.origin).href,
      ...(options.chooseAccount ? { additionalParams: { prompt: "select_account" } } : {}),
    }),
  );
  const url = stringIn(data, "url");
  if (url === null) throw new Error("Google sign-in gave no URL.");
  location.assign(url);
  const left = new AbortController();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, LEAVING_MS);
    // Going back can restore the page as it was left, its timers included.
    addEventListener("pageshow", (event) => event.persisted && resolve(), { signal: left.signal });
  });
  left.abort();
}

function stringIn(data: unknown, key: string): string | null {
  if (typeof data !== "object" || data === null) return null;
  const value: unknown = Reflect.get(data, key);
  return typeof value === "string" ? value : null;
}
