import type { Core } from "@strapi/strapi";

const allowedMediaTypes = [
  "image/*",
  "video/*",
  "audio/*",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.*",
  "text/plain",
  "text/csv",
];

const deniedTypes = [
  "image/svg+xml",
  "application/vnd.microsoft.portable-executable",
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-executable",
  "application/x-dosexec",
  "application/x-sh",
  "text/x-shellscript",
  "application/x-mach-binary",
];

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  "users-permissions": {
    config: {
      jwtManagement: "refresh",
      sessions: {
        httpOnly: true,
      },
    },
  },
  upload: {
    config: {
      // Biznet Gio, which speaks S3 with SigV4 — so the AWS provider works,
      // given an endpoint and path-style addressing. Verified against the real
      // account: region "idn", endpoint https://nos.jkt-1.neo.id.
      //
      // Local development keeps Strapi's default filesystem provider: an
      // unset AWS_BUCKET means no `provider` key, and uploads land in
      // public/uploads as before. Nobody needs object storage to write a page.
      ...(env("AWS_BUCKET")
        ? {
            provider: "aws-s3",
            providerOptions: {
              baseUrl: env("AWS_BASE_URL"),
              s3Options: {
                endpoint: env("AWS_ENDPOINT"),
                region: env("AWS_REGION", "idn"),
                // Biznet addresses buckets by path, not by subdomain.
                forcePathStyle: true,
                credentials: {
                  accessKeyId: env("AWS_ACCESS_KEY_ID"),
                  secretAccessKey: env("AWS_ACCESS_SECRET"),
                },
                params: {
                  Bucket: env("AWS_BUCKET"),
                  // The finding that decides whether the site shows
                  // photographs or broken images. `mbss-uploads` has no bucket
                  // policy and an owner-only bucket ACL; the four objects from
                  // the previous iteration answer anonymously only because
                  // whatever uploaded them set an explicit AllUsers→READ grant
                  // per object. Proven with a probe object: uploaded with no
                  // ACL it 403s, uploaded with this it 200s.
                  //
                  // Without it every editor's photograph is stored privately
                  // and Strapi hands the browser a URL that 403s.
                  ACL: "public-read",
                },
              },
            },
            // actionOptions are merged into every upload/delete call. Left
            // empty because the ACL above already belongs to `params`, which
            // the provider applies to both.
            actionOptions: { upload: {}, uploadStream: {}, delete: {} },
          }
        : {}),
      security: {
        allowedTypes: allowedMediaTypes,
        deniedTypes,
      },
    },
  },
});

export default config;
