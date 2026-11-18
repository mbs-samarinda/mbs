import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import type { Owner } from "@/owners.ts";

import { cms, CMS_TAG, type CmsLink, list, type Media, Row } from "./client.ts";

export type Site = {
  readonly ownerKey: Owner["key"];
  readonly tagline: string;
  readonly brandSubline: string | null;
  readonly logo: Media | null;
  readonly address: string | null;
  /** `"lat,lng"`. The map is drawn from it, and hidden without it. */
  readonly mapsCoordinates: string | null;
  readonly hours: string | null;
  readonly legal: string | null;
  readonly copyright: string | null;
  readonly admissionCta: string;
  /** An item with `links` is a dropdown; one without is a plain link. */
  readonly menu: readonly {
    readonly label: string;
    readonly href: string | null;
    readonly links: readonly CmsLink[];
  }[];
  readonly headerPhone: CmsLink | null;
  readonly headerWhatsapp: CmsLink | null;
  readonly footerColumns: readonly {
    readonly heading: string;
    readonly links: readonly CmsLink[];
  }[];
  readonly contacts: readonly {
    readonly label: string;
    readonly value: string;
    readonly href: string;
  }[];
  /** Official accounts. `/kontak` draws them; the footer deliberately does not. */
  readonly socials: readonly CmsLink[];
};

export const SiteRow = z.looseObject({
  menu: list(z.looseObject({ links: list(Row) })),
  footerColumns: list(z.looseObject({ links: list(Row) })),
  contacts: list(Row),
  socials: list(Row),
});

/**
 * The owner's identity, navigation, footer and contacts.
 *
 * Every site has a row — the CMS seeds one per owner on boot — so a missing one
 * is a broken deployment, not a state to render around. It throws from the
 * layout, so `global-error.tsx` renders its CMS-free shell instead of a site
 * with no navigation.
 */
export async function getSite(ownerKey: Owner["key"]): Promise<Site> {
  "use cache";
  cacheLife("content");
  cacheTag(CMS_TAG, `site:${ownerKey}`);

  const sites = await cms<Site>(
    "site-list",
    [
      ["filters[ownerKey][$eq]", ownerKey],
      ["populate[menu][populate]", "links"],
      ["populate[headerPhone]", "true"],
      ["populate[headerWhatsapp]", "true"],
      ["populate[contacts]", "true"],
      ["populate[socials]", "true"],
      ["populate[logo]", "true"],
      ["populate[footerColumns][populate]", "links"],
    ],
    SiteRow,
  );

  const site = sites[0];
  if (!site) throw new Error(`No Site row for ${ownerKey}. The CMS seeds one on boot.`);
  return site;
}
