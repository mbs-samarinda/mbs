import type { Core } from "@strapi/strapi";

/**
 * The tagline each owner starts with, from the brand guide. Editors may reword
 * it; where it may appear stays a brand rule rather than an editor choice, so
 * only the words are seeded here.
 *
 * The entry action's label sits beside it because the umbrella runs one
 * campaign across three schools rather than taking applications of its own.
 */
const OWNER_SEED = [
  {
    ownerKey: "mbs",
    tagline: "Mencetak Generasi Qur'ani, Berprestasi & Berdaya Saing",
    admissionCta: "Pendaftaran Bersama",
    brandSubline: "Samarinda",
  },
  {
    ownerKey: "smp",
    tagline: "Sekolahnya Anak Saleh, Unggul & Berkarakter",
    admissionCta: "Mulai Pendaftaran",
    brandSubline: "Madina Boarding School",
  },
  {
    ownerKey: "smk",
    tagline: "Berakhlak Mulia Siap Berkarya",
    admissionCta: "Mulai Pendaftaran",
    brandSubline: "Madina Boarding School",
  },
  {
    ownerKey: "sma",
    tagline: "Islami Unggul Mandiri",
    admissionCta: "Mulai Pendaftaran",
    brandSubline: "Madina Boarding School",
  },
] as const;

export default {
  register() {},

  /**
   * Gives every owner a Site row on first start, so no site is served without
   * an identity and no editor has to know which four keys exist. It creates
   * what is missing and never touches what is there: the seeded values are a
   * starting point, and an edited tagline must survive the next deploy.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    for (const seed of OWNER_SEED) {
      const existing = await strapi
        .documents("api::site.site")
        .findFirst({ filters: { ownerKey: seed.ownerKey } });

      if (existing) continue;

      try {
        await strapi.documents("api::site.site").create({ data: seed });
      } catch {
        // Two instances booting together both read no row and both create one;
        // the loser hits the unique key on ownerKey. That is the constraint
        // doing its job, not a reason to refuse to start.
        strapi.log.info(`Site row for ${seed.ownerKey} already created by another instance.`);
      }
    }
  },
};
