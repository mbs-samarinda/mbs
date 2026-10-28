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

  const page = await getPage(school.key, "profil");
  return {
    title: page?.seo?.metaTitle ?? "Profil",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

/**
 * Identity, history, values, leadership and achievements, on a school site only.
 * The apex never reaches the guard below — `ownerLacksPath` sends it to the
 * branded 404 — but the guard is what narrows `school`.
 *
 * Bands alternate down the page rather than being fixed per section, which is
 * how the canvas frame draws it.
 */
export default async function ProfilePage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!owner || !school) notFound();

  const [site, page] = await Promise.all([getSite(owner.key), getPage(owner.key, "profil")]);

  return (
    <main>
      <PageHead
        heading={`Profil ${owner.name}`}
        body="Identitas, sejarah, nilai, dan kepemimpinan sekolah."
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
