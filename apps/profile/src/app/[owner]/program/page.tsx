import type { Metadata } from "next";

import { getPage, getSite } from "../../../cms.ts";
import { requireSchool } from "../../../owners.ts";
import { AdmissionBandSection, BlockSection, PageHead } from "../sections.tsx";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const school = await requireSchool(params);

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
 * What a school publishes is still its own: SMK composes the offering as jurusan
 * with their kompetensi, SMP and SMA as plain programs. Nothing here decides
 * which — both are blocks an editor ordered.
 */
export default async function ProgramPage({ params }: { params: Promise<{ owner: string }> }) {
  const school = await requireSchool(params);

  const [site, page] = await Promise.all([getSite(school.key), getPage(school.key, "program")]);

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
          owner={school}
          schoolKey={school.key}
          site={site}
          tinted={index % 2 === 1}
        />
      ))}

      <AdmissionBandSection schoolKey={school.key} admissionCta={site.admissionCta} />
    </main>
  );
}
