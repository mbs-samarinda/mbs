import { SCHOOLS } from "@mbs/school-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getEntry, mediaUrl } from "../../../../cms.ts";
import { OWNERS, ownerUrl } from "../../../../owners.ts";
import { Prose } from "../../prose.tsx";
import {
  ENTRY_SECTIONS,
  EntryFacts,
  EntryHead,
  MoreEntries,
  Photo,
  SECTION,
  WIDTH,
} from "../../sections.tsx";

type Params = Promise<{ owner: string; slug: string }>;

const SECTION_INFO = ENTRY_SECTIONS["ekstrakurikuler-list"];

/** Resolves the school and the activity together, or gives up. */
async function read(params: Params) {
  const { owner: key, slug } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!owner || !school) return null;

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
    description,
    openGraph: {
      title,
      description,
      url: `${ownerUrl(owner)}ekstrakurikuler/${entry.slug}`,
      images: share ? [mediaUrl(share)] : undefined,
    },
  };
}

/**
 * Blocking, and a slug nobody owns answers 200 rather than 404 — the same two
 * facts `/artikel/[type]/[slug]` records at length. There is no `generateStaticParams`
 * because the set of activities changes whenever an editor publishes, and once a
 * response has started streaming its headers are gone, so `notFound()` after an
 * `await` can only add `<meta name="robots" content="noindex">`. That is what
 * keeps a deleted activity out of a search index.
 */
export const instant = false;

/** One activity: what it is, how it runs, and what else a visitor could look at. */
export default async function EkstrakurikulerDetailPage({ params }: { params: Params }) {
  const found = await read(params);
  if (!found) notFound();

  const { owner, entry } = found;

  return (
    <main>
      <EntryHead entry={entry} section={SECTION_INFO} />

      <section className={SECTION}>
        <div className={`${WIDTH} flex flex-col gap-8`}>
          <Photo image={entry.images[0] ?? null} label="Foto" className="aspect-20/7 w-full" />

          <div className="flex flex-col gap-10 lg:flex-row lg:gap-12">
            <div className="flex-1">
              <Prose>{entry.body}</Prose>
            </div>

            {entry.facts.length > 0 && <EntryFacts facts={entry.facts} />}
          </div>
        </div>
      </section>

      <MoreEntries ownerKey={owner.key} collection="ekstrakurikuler-list" slug={entry.slug} />
    </main>
  );
}
