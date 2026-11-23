/**
 * Where to go after sign-in, or undefined for anything that is not a path on
 * this site. The value comes from the URL, so a link in an email could set it.
 */
export function safeReturnTarget(
  target: unknown,
  options: { signInPath: string; origin?: string },
): string | undefined {
  // Browsers read a backslash as a slash, and drop tabs and newlines.
  // oxlint-disable-next-line no-control-regex
  if (typeof target !== "string" || /[\\\u0000-\u001f]/.test(target)) return undefined;
  if (!target.startsWith("/") || target.startsWith("//")) return undefined;

  const origin = options.origin ?? location.origin;
  if (!URL.canParse(target, origin)) return undefined;
  const url = new URL(target, origin);
  // `/.//evil.test` stays on this origin but its path becomes `//evil.test`.
  if (url.origin !== origin || url.pathname.startsWith("//")) return undefined;
  if (url.pathname === options.signInPath || url.pathname.startsWith(`${options.signInPath}/`)) {
    return undefined;
  }
  const path = url.pathname + url.search + url.hash;
  return path === "/" ? undefined : path;
}
