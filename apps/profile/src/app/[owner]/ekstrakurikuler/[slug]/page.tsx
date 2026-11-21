import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  ENTRY_SECTIONS,
  EntryFacts,
  EntryHead,
  MoreEntries,
} from "@/app/[owner]/_components/entry.tsx";
import { Prose } from "@/app/[owner]/_components/prose.tsx";
import {
  Main,
  Photo,
  PHOTO_SIZES,
  SECTION,
  WIDTH,
  photoTransition,
} from "@/app/[owner]/_components/section.tsx";
import { getEntry } from "@/cms/entries.ts";
import { requireSchool } from "@/owners.ts";
import { shareMetadata } from "@/share.ts";

type Params = Promise<{ owner: string; slug: string }>;

const SECTION_INFO = ENTRY_SECTIONS["ekstrakurikuler-list"];

/** Resolves the school and the activity together, or gives up. */
async function read(params: Params) {
  const { slug } = await params;
  const owner = await requireSchool(params);

  const entry = await getEntry(owner.key, "ekstrakurikuler-list", slug);
  return entry ? { owner, entry } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const found = await read(params);
  if (!found) return {};

  const { owner, entry } = found;
  const title = entry.seo?.metaTitle ?? entry.title;
  const description = entry.seo?.metaDescription ?? entry.summary ?? undefined;
  const share = entry.seo?.shareImage ?? entry.images[0];

  return {
    title,
    ...shareMetadata(owner, `ekstrakurikuler/${entry.slug}`, { description, image: share }),
  };
}

/** Blocking, for the reason `/artikel/[type]/[slug]` gives: a missing slug stays a real 404. */
export const instant = false;

/** One activity: what it is, how it runs, and what else a visitor could look at. */
export default async function EkstrakurikulerDetailPage({ params }: { params: Params }) {
  const found = await read(params);
  if (!found) notFound();

  const { owner, entry } = found;

  return (
    <Main>
      <EntryHead entry={entry} section={SECTION_INFO} />

      <section className={SECTION}>
        <div className={`${WIDTH} flex flex-col gap-8`}>
          <Photo
            sizes={PHOTO_SIZES.full}
            preload
            image={entry.images[0] ?? null}
            label="Foto"
            className="aspect-20/7 w-full"
            transition={photoTransition(SECTION_INFO.base, entry.slug)}
          />

          <div className="flex flex-col gap-10 lg:flex-row lg:gap-12">
            <div className="flex-1">
              <Prose>{entry.body}</Prose>
            </div>

            {entry.facts.length > 0 && <EntryFacts facts={entry.facts} />}
          </div>
        </div>
      </section>

      <MoreEntries ownerKey={owner.key} collection="ekstrakurikuler-list" slug={entry.slug} />
    </Main>
  );
}
