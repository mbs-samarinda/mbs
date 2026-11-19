import type { Metadata } from "next";
import { Suspense } from "react";

import { Listing, ListingPlaceholder, type Params } from "@/app/[owner]/_components/listing.tsx";
import { Main, PageHead } from "@/app/[owner]/_components/section.tsx";
import { getPage } from "@/cms/pages.ts";
import { requireSchool } from "@/owners.ts";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const school = await requireSchool(params);

  const page = await getPage(school.key, "artikel");
  return {
    title: page?.seo?.metaTitle ?? "Artikel",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

/**
 * Every article, all three types, newest first, on a school site only.
 *
 * The page head is outside the `<Suspense>` boundary and the listing inside it,
 * so the head renders without waiting on the clock-dependent listing.
 */
export default async function ArtikelPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string }>;
  searchParams: Promise<Params>;
}) {
  const school = await requireSchool(params);

  return (
    <Main>
      <PageHead heading="Artikel" body="Berita, pengumuman, dan opini terkini." />

      <Suspense fallback={<ListingPlaceholder hasSidebar hasFilters />}>
        <Listing owner={school} schoolKey={school.key} searchParams={searchParams} />
      </Suspense>
    </Main>
  );
}
