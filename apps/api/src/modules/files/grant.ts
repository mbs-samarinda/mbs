import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * What the API promised about one upload before it happened. The browser carries
 * it back when the bytes have landed, so the row written then is for the file
 * this account was allowed to send, at the size and type that were checked.
 *
 * It is signed rather than stored, because a stored row would have to be edited
 * or deleted once the upload finished, and nothing here is ever edited.
 */
const UploadGrant = z.object({
  key: z.string(),
  applicationId: z.string(),
  userId: z.string(),
  contentType: z.string(),
  byteSize: z.int().positive(),
  sha256: z.string(),
  expiresAt: z.number(),
});
export type UploadGrant = z.infer<typeof UploadGrant>;

const SEPARATOR = "\u0000";

/** Its own key, so a leak here can never stand in for a session cookie. */
function signingKey(secret: string) {
  return createHmac("sha256", secret).update("mbs/file-upload-grant/v1").digest();
}

export function signGrant(secret: string, grant: UploadGrant) {
  const body = Buffer.from(JSON.stringify(grant)).toString("base64url");
  const mac = createHmac("sha256", signingKey(secret)).update(body).digest("base64url");
  return `${body}${SEPARATOR}${mac}`;
}

export function readGrant(secret: string, token: string, now: Date): UploadGrant | null {
  const [body, mac] = token.split(SEPARATOR);
  if (!body || !mac) return null;

  const expected = createHmac("sha256", signingKey(secret)).update(body).digest("base64url");
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected))) {
    return null;
  }

  const grant = UploadGrant.safeParse(JSON.parse(Buffer.from(body, "base64url").toString()));
  if (!grant.success) return null;
  return grant.data.expiresAt > now.getTime() ? grant.data : null;
}
