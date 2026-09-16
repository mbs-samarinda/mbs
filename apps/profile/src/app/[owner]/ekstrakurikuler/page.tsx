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

  const page = await getPage(school.key, "ekstrakurikuler");
  return {
    title: page?.seo?.metaTitle ?? "Ekstrakurikuler",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

/**
 * Every activity a school runs, each linking to its own page.
 *
 * Unlike `/profil` and `/program` this is not composed: the listing is what has
 * been published in the Ekstrakurikuler collection, in one grid, and an editor
 * orders nothing here. The `Page` row exists for the title and the SEO fields.
 *
 * School-only, the shape `/program` established — the umbrella runs no classes,
 * so the apex answers 404 rather than an empty grid.
 *
 * The apex never reaches this guard: `ownerLacksPath` in `owners.ts` sends it to
 * an unclaimed path, so `global-not-found.tsx` answers with the branded 404. The
 * check stays because it is what narrows `school` for the code below, and because
 * a page should not depend on the proxy having run.
 */
export default async function EkstrakurikulerPage({
  params,
}: {
  params: Promise<{ owner: string }>;
}) {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!owner || !school) notFound();

  const entries = await getEntries(owner.key, "ekstrakurikuler-list");

  return (
    <main>
      <PageHead
        heading="Ekstrakurikuler"
        body="Kegiatan rutin di luar jam pelajaran. Setiap kegiatan punya halaman sendiri."
      />

      <section className={SECTION}>
        <div className={WIDTH}>
          {entries.length === 0 ? (
            <p className="text-base text-muted-foreground">
              Belum ada kegiatan yang dipublikasikan.
            </p>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {entries.map((entry) => (
                <EntryCard key={entry.slug} entry={entry} base="/ekstrakurikuler" />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
