import { SCHOOLS } from "@mbs/school-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  ARTICLE_KINDS,
  ARTICLE_TYPES,
  isArticleType,
  type ArticleType,
} from "../../../../articles.ts";
import { OWNERS } from "../../../../owners.ts";
import { PageHead } from "../../sections.tsx";
import { Listing, ListingPlaceholder, type Params } from "../listing.tsx";

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
  const { owner: key, type } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner || !isArticleType(type)) notFound();

  const school = SCHOOLS.find((candidate) => candidate.key === owner.key);

  return (
    <main>
      <PageHead heading={ARTICLE_KINDS[type]} body={LEAD[type]} />

      {/* Only the umbrella keeps a filter row here, for its school chips. */}
      <Suspense fallback={<ListingPlaceholder hasSidebar={Boolean(school)} hasFilters={!school} />}>
        <Listing owner={owner} schoolKey={school?.key} type={type} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
