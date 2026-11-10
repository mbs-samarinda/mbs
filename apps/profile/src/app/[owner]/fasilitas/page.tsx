import type { Metadata } from "next";

import { getEntries, getPage } from "../../../cms.ts";
import { requireSchool } from "../../../owners.ts";
import { EntryCard, PageHead, SECTION, WIDTH } from "../sections.tsx";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const school = await requireSchool(params);

  const page = await getPage(school.key, "fasilitas");
  return {
    title: page?.seo?.metaTitle ?? "Fasilitas",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

/**
 * Every facility a school has, each linking to its own page.
 *
 * Not composed, the arrangement `/ekstrakurikuler` and `/artikel` already use:
 * the listing is what has been published in the Fasilitas collection, and the
 * `Page` row exists for the title and the SEO fields. It describes buildings;
 * photographs of what happens in them belong to `/galeri`.
 *
 * School-only. The umbrella owns no buildings, so the apex answers 404 rather
 * than an empty grid.
 */
export default async function FasilitasPage({ params }: { params: Promise<{ owner: string }> }) {
  const school = await requireSchool(params);

  const entries = await getEntries(school.key, "fasilitas-list");

  return (
    <main>
      <PageHead heading="Fasilitas" body="Keterangan dan foto tiap fasilitas." />

      <section className={SECTION}>
        <div className={WIDTH}>
          {entries.length === 0 ? (
            <p className="text-base text-muted-foreground">
              Belum ada fasilitas yang dipublikasikan.
            </p>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {entries.map((entry) => (
                <EntryCard key={entry.slug} entry={entry} base="/fasilitas" />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
