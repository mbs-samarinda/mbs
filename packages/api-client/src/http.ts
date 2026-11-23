/** The API never answered: no network, a timeout, or a proxy with nothing behind it. */
export class UnreachableError extends Error {
  override name = "UnreachableError";
}

const TIMEOUT_MS = 20_000;

/**
 * `fetch` to this app's own API. The API puts `x-request-id` on every answer, so
 * an answer without one came from a proxy that could not reach it.
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(input, { ...init, signal });
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    throw new UnreachableError("The API did not answer.", { cause });
  }
  if (!response.headers.has("x-request-id")) {
    throw new UnreachableError("A proxy answered instead of the API.");
  }
  return response;
}
