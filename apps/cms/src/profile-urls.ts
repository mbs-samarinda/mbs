/**
 * Where each owner's profile site lives. The CMS has no list of the profile's
 * hosts — `PUBLIC_URL` is its own address — so this copies the profile's
 * `ownerHost` and `ownerUrl` rules.
 *
 * `apex` is passed in because the two callers want different fallbacks when
 * `PROFILE_APEX` is unset: an invite's copy names production, which is what an
 * invitee recognises, while a preview link has to open the profile running on
 * this machine.
 */
export function profileOrigin(ownerKey: string, apex: string): string {
  const host = ownerKey === "mbs" ? apex : `${ownerKey}.${apex}`;
  // 3002 is the profile's own dev port. `PROFILE_DEV_PORT` exists for the
  // verify stack, which runs the profile on another port.
  return apex === "localhost"
    ? `http://${host}:${process.env.PROFILE_DEV_PORT || "3002"}`
    : `https://${host}`;
}
