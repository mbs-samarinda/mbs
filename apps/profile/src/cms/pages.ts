import type { SchoolKey } from "@mbs/school-config";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import type { Owner } from "@/owners.ts";

import type { Achievement } from "./articles.ts";
import { cms, CMS_TAG, list, type Media, Row } from "./client.ts";
import { ActivityRow, EntryRow, type Activity, type Entry } from "./entries.ts";

type SectionHead = {
  readonly heading: string;
  readonly description: string | null;
  readonly linkLabel: string | null;
  readonly linkHref: string | null;
};

/**
 * The icons a value on `/profil` can carry, bounded by the CMS enumeration. A
 * value the CMS gains before this list does is drawn as a book.
 */
const ValueIconSchema = z
  .enum(["kitab", "perisai", "kunci", "tangan", "orang", "topi-wisuda"])
  .catch("kitab");

export type ValueIcon = z.infer<typeof ValueIconSchema>;

export type Block = { readonly id: number } & (
  | {
      readonly kind: "hero";
      // Optional, and the page falls back to the owner's tagline. That is how
      // the umbrella's promise reaches its own headline without being typed a
      // second time into a block — it is `Site.tagline`, and nowhere else.
      heading: string | null;
      body: string | null;
      image: Media | null;
      // The outline action beside the entry CTA. Both halves or neither: a
      // label with no address is a button that goes nowhere, and an address
      // with no label is invisible.
      //
      // The CMS constrains the address to `/path` or `#anchor`. It is rendered
      // into an `href`, so a free-text field would take `javascript:` and an
      // address with no leading slash resolves against whatever route the
      // visitor is on — and an absolute one at the apex is the production-link
      // trap `ownerUrl` exists to stop.
      secondaryLabel: string | null;
      secondaryHref: string | null;
    }
  | {
      readonly kind: "schools";
      head: SectionHead;
      // The card carries no link and no school name: both are derived from the
      // key. A URL typed at the apex is the one shape that cannot be relative,
      // so a field here would send every local and staging visitor to
      // production, and the names already live in `packages/school-config`.
      items: readonly {
        id: number;
        school: SchoolKey;
        meta: string | null;
        description: string | null;
        photo: Media | null;
      }[];
    }
  | {
      readonly kind: "image-text";
      heading: string | null;
      body: string;
      image: Media | null;
      imageSide: "awal" | "akhir";
    }
  | {
      readonly kind: "programs";
      head: SectionHead;
      items: readonly { title: string; description: string | null; points: string | null }[];
    }
  | {
      readonly kind: "highlights";
      items: readonly { id: number; label: string; value: string }[];
    }
  | {
      readonly kind: "majors";
      head: SectionHead;
      items: readonly {
        id: number;
        code: string | null;
        title: string;
        meta: string | null;
        description: string | null;
        points: string | null;
      }[];
    }
  | { readonly kind: "facilities"; head: SectionHead; items: readonly Entry[] }
  | { readonly kind: "extracurriculars"; head: SectionHead; items: readonly Activity[] }
  | { readonly kind: "achievements"; head: SectionHead; items: readonly Achievement[] }
  | {
      readonly kind: "facts";
      heading: string;
      body: string | null;
      items: readonly { id: number; label: string; value: string }[];
    }
  | {
      readonly kind: "timeline";
      head: SectionHead;
      items: readonly { id: number; year: number; body: string }[];
    }
  | {
      readonly kind: "values";
      head: SectionHead;
      items: readonly { id: number; icon: ValueIcon; title: string; description: string | null }[];
    }
  | {
      readonly kind: "people";
      head: SectionHead;
      items: readonly { id: number; name: string; role: string; photo: Media | null }[];
    }
  | {
      readonly kind: "layers";
      head: SectionHead;
      items: readonly { id: number; title: string; description: string | null }[];
    }
  | { readonly kind: "news"; head: SectionHead; limit: number }
  | { readonly kind: "admission-cta"; heading: string; body: string | null }
  | { readonly kind: "rich-text"; body: string }
  | {
      readonly kind: "contact";
      head: SectionHead;
      showMap: boolean;
      items: readonly {
        id: number;
        title: string;
        description: string | null;
        channelValue: string;
        channelHref: string;
        ctaLabel: string;
        hours: string | null;
        email: string | null;
      }[];
    }
  | {
      readonly kind: "faq";
      head: SectionHead;
      // Strapi gives every repeatable component row an id. It is the only
      // stable key here: two identical questions are an editing mistake the
      // content model does not forbid.
      items: readonly { id: number; question: string; answer: string }[];
    }
);

export type Page = {
  readonly title: string;
  readonly blocks: readonly Block[];
  readonly seo: {
    readonly metaTitle: string | null;
    readonly metaDescription: string | null;
    readonly shareImage: Media | null;
  } | null;
};

/** The blocks whose items carry a field that crashes a render when it is wrong. */
const BLOCK_ITEMS: Partial<Record<string, z.ZodType>> = {
  "blocks.values": list(z.looseObject({ icon: ValueIconSchema })),
  "blocks.facilities": list(EntryRow),
  "blocks.extracurriculars": list(ActivityRow),
};

const Items = list(Row);

/**
 * One composed section. Strapi names the discriminator `__component` and
 * prefixes every value with `blocks.`. Renamed here so the pages switch on a
 * plain `kind` and never see the prefix. Every block gets an `items` list, so a
 * block with an empty repeatable maps over `[]`.
 */
const BlockRow = z
  .looseObject({ __component: z.string() })
  .transform(({ __component: component, ...rest }) => ({
    ...rest,
    items: (BLOCK_ITEMS[component] ?? Items).parse(rest.items),
    kind: component.slice("blocks.".length),
  }));

export const PageRow = z.looseObject({ blocks: list(BlockRow) });

/**
 * Strapi 5 populates a dynamic zone per component, so every block that holds a
 * relation, a nested component or an image has to name what it needs. A block
 * left out of this list does not arrive at all — the `on` fragment drops it from
 * the response rather than returning it bare. Add a block here when you render
 * it, or the page renders nothing where the editor placed it.
 */
const BLOCK_POPULATE: [string, string][] = [
  ["populate[blocks][on][blocks.hero][populate]", "*"],
  ["populate[blocks][on][blocks.schools][populate][head]", "true"],
  ["populate[blocks][on][blocks.schools][populate][items][populate]", "photo"],
  ["populate[blocks][on][blocks.image-text][populate]", "*"],
  ["populate[blocks][on][blocks.programs][populate]", "*"],
  ["populate[blocks][on][blocks.highlights][populate]", "*"],
  ["populate[blocks][on][blocks.majors][populate]", "*"],
  ["populate[blocks][on][blocks.news][populate]", "*"],
  ["populate[blocks][on][blocks.admission-cta][populate]", "*"],
  ["populate[blocks][on][blocks.rich-text][populate]", "*"],
  ["populate[blocks][on][blocks.facts][populate]", "*"],
  ["populate[blocks][on][blocks.timeline][populate]", "*"],
  ["populate[blocks][on][blocks.values][populate]", "*"],
  ["populate[blocks][on][blocks.layers][populate]", "*"],
  ["populate[blocks][on][blocks.people][populate][head]", "true"],
  ["populate[blocks][on][blocks.people][populate][items][populate]", "photo"],
  ["populate[blocks][on][blocks.contact][populate][head]", "true"],
  ["populate[blocks][on][blocks.contact][populate][items]", "true"],
  ["populate[blocks][on][blocks.faq][populate][head]", "true"],
  ["populate[blocks][on][blocks.faq][populate][items]", "true"],
  ["populate[blocks][on][blocks.facilities][populate][head]", "true"],
  ["populate[blocks][on][blocks.facilities][populate][items][populate]", "images"],
  ["populate[blocks][on][blocks.extracurriculars][populate][head]", "true"],
  ["populate[blocks][on][blocks.extracurriculars][populate][items][populate]", "images"],
  ["populate[blocks][on][blocks.achievements][populate][head]", "true"],
  // Two keys rather than one comma-separated value: Strapi rejects the comma
  // form inside a dynamic-zone fragment with a 400.
  ["populate[blocks][on][blocks.achievements][populate][items][populate][0]", "photo"],
  ["populate[blocks][on][blocks.achievements][populate][items][populate][1]", "berita"],
  ["populate[seo][populate]", "*"],
];

/** One route's composed sections. `null` when no editor has published it. */
export async function getPage(ownerKey: Owner["key"], slug: string): Promise<Page | null> {
  "use cache";
  cacheLife("content");
  cacheTag(CMS_TAG, `page:${ownerKey}:${slug}`);

  const pages = await cms<Page>(
    "page-list",
    [["filters[ownerKey][$eq]", ownerKey], ["filters[slug][$eq]", slug], ...BLOCK_POPULATE],
    PageRow,
  );

  return pages[0] ?? null;
}
