import type { Core } from "@strapi/strapi";

const config: Core.Config.Features = {
  // Strapi 5.54 made a redesigned media library the default. Editors keep the
  // one they know until the new one is checked with their role, and with the
  // CSP in middlewares.ts: it previews PDFs in a frame, which the CSP blocks.
  useLegacyMediaLibrary: true,
};

export default config;
