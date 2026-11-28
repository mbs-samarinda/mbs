import type { Transaction } from "@mbs/db";
import { PROOF_CONTENT_TYPES, PROOF_MAX_BYTES } from "@mbs/school-config";

import { UploadIncompleteError } from "../../errors.ts";
import { readGrant, signGrant } from "./grant.ts";
import { newObjectKey, type KeyPrefix } from "./keys.ts";
import { insertFile, type FileRow } from "./repository.ts";
import type { Storage } from "./storage.ts";

export { KEY_PREFIXES } from "./keys.ts";
export { createStorage, type Storage } from "./storage.ts";

export type Files = ReturnType<typeof createFiles>;

export type UploadRequest = {
  prefix: KeyPrefix;
  applicationId: string;
  userId: string;
  contentType: string;
  byteSize: number;
  /**
   * Base64, as the browser computed it. The bucket is not asked to check it: a
   * presigned PUT signs only the length and the host, and flexible checksums
   * are not everywhere. It is a fingerprint of what the browser believed it
   * sent, and the size at `completeUpload` is what is actually checked.
   */
  sha256: string;
};

export function createFiles(storage: Storage, secret: string, uploadUrlSeconds: number) {
  return {
    /**
     * Signs one upload. The caller has already checked that this account may act
     * on this application; what is checked here is the file itself.
     */
    async beginUpload(request: UploadRequest, now = new Date()) {
      const key = newObjectKey(request.prefix);
      const uploadUrl = await storage.signUpload({
        key,
        contentType: request.contentType,
        byteSize: request.byteSize,
      });
      const token = signGrant(secret, {
        key,
        applicationId: request.applicationId,
        userId: request.userId,
        contentType: request.contentType,
        byteSize: request.byteSize,
        sha256: request.sha256,
        expiresAt: now.getTime() + uploadUrlSeconds * 1000,
      });
      return { uploadUrl, token, expiresInSeconds: uploadUrlSeconds };
    },

    /**
     * Writes the `files` row once the bytes have landed. The size comes from the
     * bucket, not from the browser, so the row describes what is actually there.
     */
    async completeUpload(
      tx: Transaction,
      claim: { token: string; applicationId: string; userId: string },
      now = new Date(),
    ): Promise<FileRow> {
      const grant = readGrant(secret, claim.token, now);
      if (!grant || grant.applicationId !== claim.applicationId || grant.userId !== claim.userId) {
        throw new UploadIncompleteError("This upload was not the one that was signed.");
      }

      const stored = await storage.head(grant.key);
      if (!stored) throw new UploadIncompleteError("The file never reached the bucket.");
      if (stored.byteSize !== grant.byteSize) {
        throw new UploadIncompleteError("The stored file is not the size that was signed.");
      }

      return insertFile(tx, {
        objectKey: grant.key,
        byteSize: stored.byteSize,
        contentType: grant.contentType,
        sha256: grant.sha256,
        uploadedByUserId: grant.userId,
      });
    },

    signDownload(file: Pick<FileRow, "objectKey" | "contentType">) {
      return storage.signDownload({ key: file.objectKey, contentType: file.contentType });
    },
  };
}

/** What a receipt may be. Refused here rather than at the bucket, so the family reads why. */
export function proofProblem(file: { contentType: string; byteSize: number }) {
  if (!(PROOF_CONTENT_TYPES as readonly string[]).includes(file.contentType)) {
    return "TYPE" as const;
  }
  if (file.byteSize <= 0 || file.byteSize > PROOF_MAX_BYTES) return "SIZE" as const;
  return null;
}
