import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Listing, ListingPlaceholder, type Params } from "@/app/[owner]/_components/listing.tsx";
import { Main, PageHead } from "@/app/[owner]/_components/section.tsx";
import { ARTICLE_KINDS, ARTICLE_TYPES, isArticleType, type ArticleType } from "@/articles.ts";
import { requireSchool } from "@/owners.ts";

type RouteParams = Promise<{ owner: string; type: string }>;

/** One line under each type's heading. Fixed in code: these pages have no CMS row. */
const LEAD = {
  berita: "Kabar dan kegiatan terkini.",
  pengumuman: "Pemberitahuan terkini.",
  opini: "Tulisan bebas dari civitas sekolah.",
} as const satisfies Record<ArticleType, string>;

export function generateStaticParams() {
  return ARTICLE_TYPES.map((type) => ({ type }));
}

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { type } = await params;
  return isArticleType(type) ? { title: ARTICLE_KINDS[type], description: LEAD[type] } : {};
}

/** One type's articles, newest first, with its own month archive. */
export default async function TypePage({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: Promise<Params>;
}) {
  const { type } = await params;
  const school = await requireSchool(params);
  if (!isArticleType(type)) notFound();

  return (
    <Main>
      <PageHead heading={ARTICLE_KINDS[type]} body={LEAD[type]} />

      <Suspense fallback={<ListingPlaceholder hasSidebar hasFilters={false} />}>
        <Listing owner={school} schoolKey={school.key} type={type} searchParams={searchParams} />
      </Suspense>
    </Main>
  );
}
