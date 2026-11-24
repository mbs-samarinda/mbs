/** No whole answer came from the API: no network, a timeout, a cut-off body, or a proxy alone. */
export class UnreachableError extends Error {
  override name = "UnreachableError";
}

let clockOffset = 0;

/**
 * The time by the API's clock, from the answer it gave last. A phone's own clock
 * can be days or decades off, and dates here decide what a family is offered.
 * Display and hints only: the API decides again when a request arrives.
 */
export function serverNow() {
  return new Date(Date.now() + clockOffset);
}

const TIMEOUT_MS = 20_000;

/**
 * `fetch` to this app's own API. The API's routes all answer with `x-request-id`,
 * so an answer without one came from a proxy that could not reach it.
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
  const sentAt = Date.parse(response.headers.get("date") ?? "");
  if (!Number.isNaN(sentAt)) clockOffset = sentAt - Date.now();
  return response;
}
