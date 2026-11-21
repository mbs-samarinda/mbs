import type { Core } from "@strapi/strapi";

import { previewConfig } from "../src/preview";

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Admin => ({
  auth: {
    secret: env("ADMIN_JWT_SECRET")!,
  },
  apiToken: {
    salt: env("API_TOKEN_SALT")!,
  },
  transfer: {
    token: {
      salt: env("TRANSFER_TOKEN_SALT")!,
    },
  },
  secrets: {
    encryptionKey: env("ENCRYPTION_KEY")!,
  },
  // The Preview button beside each entry. Free in Strapi; only the in-frame
  // editing of "advanced preview" needs a licence, and nothing here uses it.
  preview: previewConfig(),
  flags: {
    nps: env.bool("FLAG_NPS", true),
    promoteEE: env.bool("FLAG_PROMOTE_EE", true),
    docLinks: env.bool("FLAG_DOC_LINKS", true),
  },
});

export default config;
