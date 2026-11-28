import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { Config } from "../../config/env.ts";

export type Storage = {
  /** The browser PUTs the bytes here. The API never holds them. */
  signUpload(object: { key: string; contentType: string; byteSize: number }): Promise<string>;
  signDownload(object: { key: string; contentType: string }): Promise<string>;
  /** What the bucket says is there, or null if the upload never landed. */
  head(key: string): Promise<{ byteSize: number } | null>;
};

export function createStorage(config: Config["storage"]): Storage {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    // MinIO and most S3-compatible buckets serve the bucket as a path, not as
    // a subdomain of the endpoint.
    forcePathStyle: true,
    // Without this the SDK adds a CRC32 header of its own to every signed PUT,
    // which the browser never sends, so the bucket refuses the upload.
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
  });

  return {
    // A presigned URL signs `content-length;host` and nothing else, so the size
    // is bound but the type is not. That is why the stored type comes from the
    // grant and the download below names it, rather than trusting the object's.
    signUpload: ({ key, contentType, byteSize }) =>
      getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: byteSize,
        }),
        { expiresIn: config.uploadUrlSeconds },
      ),

    signDownload: ({ key, contentType }) =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
          // A receipt is shown, never downloaded as an attachment, and the type
          // is the one we recorded rather than whatever the bucket guesses.
          ResponseContentType: contentType,
          ResponseContentDisposition: "inline",
        }),
        { expiresIn: config.downloadUrlSeconds },
      ),

    head: async (key) => {
      try {
        const found = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return { byteSize: found.ContentLength ?? 0 };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
  };
}

function isMissing(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return status === 404 || (error as { name?: string }).name === "NotFound";
}
