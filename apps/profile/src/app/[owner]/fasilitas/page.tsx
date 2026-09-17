import { SCHOOLS } from "@mbs/school-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getEntries, getPage } from "../../../cms.ts";
import { OWNERS } from "../../../owners.ts";
import { EntryCard, PageHead, SECTION, WIDTH } from "../sections.tsx";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const { owner: key } = await params;
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!school) return {};

  const page = await getPage(school.key, "fasilitas");
  return {
    title: page?.seo?.metaTitle ?? "Fasilitas",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

/**
 * Every facility a school has, each linking to its own page.
 *
 * Not composed, the arrangement `/ekstrakurikuler` and `/berita` already use:
 * the listing is what has been published in the Fasilitas collection, and the
 * `Page` row exists for the title and the SEO fields. This is descriptions and
 * photographs rather than a gallery — the reason no gallery block was modelled.
 *
 * School-only. The umbrella owns no buildings, so the apex answers 404 rather
 * than an empty grid; `ownerLacksPath` sends it to an unclaimed path before this
 * renders, and the guard below is what narrows `school` for the code after it.
 */
export default async function FasilitasPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!owner || !school) notFound();

  const entries = await getEntries(owner.key, "fasilitas-list");

  return (
    <main>
      <PageHead
        heading="Fasilitas"
        body="Keterangan dan foto tiap fasilitas, bukan galeri lepas."
      />

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
