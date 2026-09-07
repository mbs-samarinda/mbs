import { createAuthClient } from "better-auth/react";

// Same-origin, like api.ts: Caddy in production and the Vite proxy in
// development both send /api to Fastify, so there is no environment-specific
// URL here.
export const auth = createAuthClient();

/**
 * Sends the browser to Google.
 *
 * Both targets are absolute. Better Auth stores them verbatim and returns them
 * as a Location header from the API, so a relative path resolves against the
 * API's origin rather than this app's — in development that is a Fastify 404
 * on port 3001.
 */
export function signInWithGoogle() {
  return auth.signIn.social({
    provider: "google",
    callbackURL: `${window.location.origin}/`,
    errorCallbackURL: `${window.location.origin}/access-denied`,
  });
}

/** Used by the dead ends, where the fix is to arrive as somebody else. */
export async function signInAsSomebodyElse() {
  await auth.signOut();
  await signInWithGoogle();
}
