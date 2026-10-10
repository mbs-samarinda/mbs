import { SCHOOLS } from "@mbs/school-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getPage } from "../../../cms.ts";
import { OWNERS } from "../../../owners.ts";
import { PageHead } from "../sections.tsx";
import { Listing, ListingPlaceholder, type Params } from "./listing.tsx";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) return {};

  const page = await getPage(owner.key, "artikel");
  return {
    title: page?.seo?.metaTitle ?? "Artikel",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

/**
 * Every article, all three types, newest first.
 *
 * The page head is outside the `<Suspense>` boundary and the listing inside it,
 * which is what keeps the shell prerendering.
 */
export default async function ArtikelPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string }>;
  searchParams: Promise<Params>;
}) {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) notFound();

  const school = SCHOOLS.find((candidate) => candidate.key === owner.key);

  return (
    <main>
      <PageHead
        heading="Artikel"
        body={
          school
            ? "Berita, pengumuman, dan opini. Terbaru lebih dulu."
            : "Kabar yayasan dan ketiga sekolah. Terbaru lebih dulu."
        }
      />

      <Suspense fallback={<ListingPlaceholder hasSidebar={Boolean(school)} hasFilters />}>
        <Listing owner={owner} schoolKey={school?.key} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
