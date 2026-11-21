import type { Metadata } from "next";
import { Suspense } from "react";

import { Listing, ListingPlaceholder, type Params } from "@/app/[owner]/_components/listing.tsx";
import { Arrival, Main, PageHead, Placeholder } from "@/app/[owner]/_components/section.tsx";
import { getPage } from "@/cms/pages.ts";
import { requireSchool } from "@/owners.ts";
import { shareMetadata } from "@/share.ts";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const school = await requireSchool(params);

  const page = await getPage(school.key, "artikel");
  return {
    title: page?.seo?.metaTitle ?? "Artikel",
    ...shareMetadata(school, "artikel", {
      description: page?.seo?.metaDescription,
      image: page?.seo?.shareImage,
    }),
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

      <Suspense
        fallback={
          <Placeholder>
            <ListingPlaceholder hasSidebar hasFilters />
          </Placeholder>
        }
      >
        <Arrival>
          <Listing owner={school} schoolKey={school.key} searchParams={searchParams} />
        </Arrival>
      </Suspense>
    </Main>
  );
}
