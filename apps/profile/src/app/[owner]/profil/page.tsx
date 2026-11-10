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

  const page = await getPage(school.key, "profil");
  return {
    title: page?.seo?.metaTitle ?? "Profil",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

/**
 * Identity, history, values, leadership and achievements, on a school site only.
 *
 * Bands alternate down the page rather than being fixed per section, which is
 * how the canvas frame draws it.
 */
export default async function ProfilePage({ params }: { params: Promise<{ owner: string }> }) {
  const school = await requireSchool(params);

  const [site, page] = await Promise.all([getSite(school.key), getPage(school.key, "profil")]);

  return (
    <main>
      <PageHead
        heading={`Profil ${school.name}`}
        body="Identitas, sejarah, nilai, dan kepemimpinan sekolah."
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
