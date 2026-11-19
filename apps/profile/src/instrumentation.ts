import type { Instrumentation } from "next";

/**
 * One JSON line per server error, so a visitor's "Ref" code (the digest) leads
 * to the host and path that failed. Next still prints its own multi-line stack
 * beside this; that cannot be turned off, so this line is the searchable index
 * and the stack is the detail.
 *
 * The query string is dropped and no headers are logged: `engineering.md` keeps
 * personal data out of logs, and neither is needed to find a failing page.
 * Each cause's code is kept because it names the real failure
 * (`ECONNREFUSED` is "Strapi is down"). The walk stops at a few levels, so a
 * cause chain that loops back on itself cannot hang the server.
 *
 * One failed CMS read is handed to every place that awaited it (layout,
 * metadata, page), and Next reports each, so the same error object arrives
 * several times. It is logged once per host and path, so two visitors on
 * different pages who share one in-flight read still get a line each.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const path = request.path.split("?")[0];
  const page = `${String(request.headers.host)}${path}`;
  if (typeof error === "object" && error !== null) {
    const pages = reported.get(error) ?? new Set<string>();
    if (pages.has(page)) return;
    reported.set(error, pages.add(page));
  }

  const causes: string[] = [];
  for (let cause = errorCause(error); cause && causes.length < 5; cause = errorCause(cause)) {
    causes.push(`${cause.name}${codeOf(cause)}`);
  }

  // oxlint-disable-next-line eslint/no-console -- stderr is the log; `process` is not in the Edge build
  console.error(
    JSON.stringify({
      level: "error",
      time: new Date().toISOString(),
      digest:
        error instanceof Error && "digest" in error && typeof error.digest === "string"
          ? error.digest
          : undefined,
      host: request.headers.host,
      method: request.method,
      path,
      route: context.routePath,
      routeType: context.routeType,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      causes,
    }),
  );
};

const reported = new WeakMap<object, Set<string>>();

const errorCause = (value: unknown): Error | undefined =>
  value instanceof Error && value.cause instanceof Error ? value.cause : undefined;

const codeOf = (error: Error) =>
  "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
