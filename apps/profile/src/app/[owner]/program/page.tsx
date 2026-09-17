import { SCHOOLS } from "@mbs/school-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPage, getSite } from "../../../cms.ts";
import { OWNERS } from "../../../owners.ts";
import { AdmissionBandSection, BlockSection, PageHead } from "../sections.tsx";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const { owner: key } = await params;
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!school) return {};

  const page = await getPage(school.key, "program");
  return {
    title: page?.seo?.metaTitle ?? "Program",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

/**
 * The academic offering, on a school site only.
 *
 * The umbrella runs no classes: its navigation carries no Program item, the
 * canvas draws it no such page, and the CMS seeds it no row. So the apex answers
 * 404 here rather than rendering a page with nothing in it — the first route in
 * this app that belongs to the schools alone, and the shape `/ekstrakurikuler`
 * and `/fasilitas` follow.
 *
 * The apex never reaches this guard: `ownerLacksPath` in `owners.ts` sends it to
 * an unclaimed path, so `global-not-found.tsx` answers with the branded 404. The
 * check stays because it is what narrows `school` for the code below, and because
 * a page should not depend on the proxy having run.
 *
 * What a school publishes is still its own: SMK composes the offering as jurusan
 * with their kompetensi, SMP and SMA as plain programs. Nothing here decides
 * which — both are blocks an editor ordered.
 */
export default async function ProgramPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!owner || !school) notFound();

  const [site, page] = await Promise.all([getSite(owner.key), getPage(owner.key, "program")]);

  return (
    <main>
      <PageHead
        heading="Program akademik"
        body="Kurikulum, jenjang, keunggulan, dan program yang dijalankan sekolah."
      />

      {(page?.blocks ?? []).map((block, index) => (
        <BlockSection
          key={`${block.kind}-${block.id}`}
          block={block}
          owner={owner}
          schoolKey={school.key}
          site={site}
          tinted={index % 2 === 1}
        />
      ))}

      <AdmissionBandSection schoolKey={school.key} admissionCta={site.admissionCta} />
    </main>
  );
}
