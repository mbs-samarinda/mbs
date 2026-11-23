import { apiFetch, UnreachableError } from "./http.ts";

export type Account = { email: string };

/** What Better Auth refused, with the code the screen explains. */
export class AuthError extends Error {
  override name = "AuthError";
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;
  /** The whole answer, for a code that says more than its name. */
  readonly details: unknown;

  constructor(
    status: number,
    code: string | null,
    retryAfterSeconds: number | null,
    details: unknown = null,
  ) {
    super(`Sign-in request refused: ${code ?? status}`);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.details = details;
  }
}

/** Plain fetch, not Better Auth's client library, to keep the first load small. */
export async function authRequest(path: string, body?: object): Promise<unknown> {
  const response = await apiFetch(
    `/api/auth${path}`,
    body && {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (response.ok) {
    // Never null: a body cut off on the way would then read as "no account".
    return response.json().catch((cause: unknown) => {
      throw new UnreachableError("The answer was cut off.", { cause });
    });
  }
  const data: unknown = await response.json().catch(() => null);
  const retryAfter = Number(response.headers.get("x-retry-after"));
  throw new AuthError(
    response.status,
    stringIn(data, "code"),
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    data,
  );
}

/** The signed-in account, or null. */
export async function fetchAccount(): Promise<Account | null> {
  const data = await authRequest("/get-session");
  const user = typeof data === "object" && data !== null && "user" in data ? data.user : null;
  const email = stringIn(user, "email");
  return email === null ? null : { email };
}

export async function signOut() {
  await authRequest("/sign-out", {});
}

/**
 * Asks for the Google page to send the browser to. Both paths must already be
 * safe return targets; Better Auth checks them against the app's origin too.
 * `chooseAccount` makes Google ask, where it would reuse its only account in
 * silence and refuse the visitor a second time.
 */
export async function googleSignInUrl(options: {
  returnTo: string;
  errorTo: string;
  chooseAccount: boolean;
}) {
  const data = await authRequest("/sign-in/social", {
    provider: "google",
    callbackURL: new URL(options.returnTo, location.origin).href,
    errorCallbackURL: new URL(options.errorTo, location.origin).href,
    ...(options.chooseAccount ? { additionalParams: { prompt: "select_account" } } : {}),
  });
  const url = stringIn(data, "url");
  if (url === null) throw new Error("Google sign-in gave no URL.");
  return url;
}

function stringIn(data: unknown, key: string): string | null {
  if (typeof data !== "object" || data === null) return null;
  const value: unknown = Reflect.get(data, key);
  return typeof value === "string" ? value : null;
}
