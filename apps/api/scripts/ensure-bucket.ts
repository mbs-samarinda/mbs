/**
 * Creates the bucket and allows the two app origins to upload to it straight
 * from a browser. Run against a local or verify bucket, never production:
 * Biznet's bucket and its CORS rule are set by hand, once, by the operator.
 *
 *   node apps/api/scripts/ensure-bucket.ts
 *   node apps/api/scripts/ensure-bucket.ts --check   # is it there?
 */
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { loadConfig } from "../src/config/env.ts";

const config = loadConfig();
const { storage, auth } = config;

const client = new S3Client({
  region: storage.region,
  endpoint: storage.endpoint,
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  credentials: { accessKeyId: storage.accessKey, secretAccessKey: storage.secretKey },
});

// `--check` asks only whether the bucket is there and the keys work, so a
// readiness probe never writes.
if (process.argv.includes("--check")) {
  await client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
  process.exit(0);
}

try {
  await client.send(new CreateBucketCommand({ Bucket: storage.bucket }));
} catch (error) {
  const name = error instanceof Error ? error.name : "";
  if (!["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(name)) throw error;
}

const origins = [auth.familyAppUrl, auth.adminAppUrl].map((url) => new URL(url).origin);
await client.send(
  new PutBucketCorsCommand({
    Bucket: storage.bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ["PUT", "GET"],
          AllowedHeaders: ["content-type"],
          MaxAgeSeconds: 600,
        },
      ],
    },
  }),
);

console.log(`bucket ${storage.bucket} ready at ${storage.endpoint} for ${origins.join(", ")}`);
