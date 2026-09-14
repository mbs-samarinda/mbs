import { SCHOOLS } from "@mbs/school-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPage, getSite } from "../../cms.ts";
import { OWNERS } from "../../owners.ts";
import { AdmissionBandSection, BlockSection } from "./sections.tsx";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) return {};

  const page = await getPage(owner.key, "home");
  return {
    // The home page wears the owner's name alone rather than the layout's
    // "page · owner" template: "Beranda · SMK Terpadu Madina" says nothing the
    // second half does not.
    title: { absolute: page?.seo?.metaTitle ?? owner.name },
    description: page?.seo?.metaDescription ?? undefined,
  };
}

export default async function OwnerHomePage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: key } = await params;
  // The layout above rejects a key that is no owner's before this renders, so
  // this cannot fire. It raises rather than falling back to an owner, because
  // substituting one would turn the failure the guard exists to stop — one
  // owner's content under another owner's hostname — into a successful page.
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) notFound();

  const [site, page] = await Promise.all([getSite(owner.key), getPage(owner.key, "home")]);
  const school = SCHOOLS.find((candidate) => candidate.key === owner.key);

  return (
    <main>
      {(page?.blocks ?? []).map((block) => (
        <BlockSection
          // Component ids are unique per component table, not across the zone,
          // so a hero and a news block on a fresh database are both id 1.
          key={`${block.kind}-${block.id}`}
          block={block}
          owner={owner}
          schoolKey={school?.key}
          admissionCta={site.admissionCta}
        />
      ))}

      {/* The admission path is never removable, so the band is the page's own
          and not a block an editor can delete. */}
      <AdmissionBandSection schoolKey={school?.key} admissionCta={site.admissionCta} />
    </main>
  );
}
