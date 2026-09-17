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
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) return {};

  const page = await getPage(owner.key, "profil");
  return {
    title: page?.seo?.metaTitle ?? "Profil",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

/**
 * The profile page, for a school and for the umbrella.
 *
 * Every section is a block an editor ordered, so the two owners differ only in
 * what they publish: a school carries identity, history, values, leadership and
 * its achievements; the umbrella carries the yayasan's identity, the three
 * layers behind the name, and the yayasan's own history. Nothing here decides
 * which of those appears.
 *
 * Bands alternate down the page rather than being fixed per section, which is
 * how both canvas frames draw it — the school's five sections and the
 * umbrella's three both start on the page ground.
 */
export default async function ProfilePage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) notFound();

  const [site, page] = await Promise.all([getSite(owner.key), getPage(owner.key, "profil")]);
  const school = SCHOOLS.find((candidate) => candidate.key === owner.key);

  return (
    <main>
      <PageHead
        heading={school ? `Profil ${owner.name}` : "Profil"}
        body={
          school
            ? "Identitas, sejarah, nilai, dan kepemimpinan sekolah."
            : "Identitas yayasan, Madina Boarding School, dan struktur di belakangnya."
        }
      />

      {(page?.blocks ?? []).map((block, index) => (
        <BlockSection
          key={`${block.kind}-${block.id}`}
          block={block}
          owner={owner}
          schoolKey={school?.key}
          admissionCta={site.admissionCta}
          tagline={site.tagline}
          tinted={index % 2 === 1}
        />
      ))}

      {/* The umbrella's frame ends at its history, with no band: it takes no
          applications of its own, and its joint campaign is already one click
          away in the header. A school closes with the band, as every other
          school page does. */}
      {school && <AdmissionBandSection schoolKey={school.key} admissionCta={site.admissionCta} />}
    </main>
  );
}
