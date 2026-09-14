import { SCHOOLS, type SchoolKey } from "@mbs/school-config";
import { Badge } from "@mbs/ui/components/badge";
import { Mail, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  getArticle,
  getArticleIndex,
  getRelatedAchievement,
  mediaUrl,
  type Achievement,
  type Article,
  type FullArticle,
} from "../../../../cms.ts";
import { OWNERS, ownerUrl, type Owner } from "../../../../owners.ts";
import { Prose } from "../../prose.tsx";
import {
  AdmissionCardSection,
  Photo,
  SECTION,
  WIDTH,
  formatDate,
  formatLongDate,
} from "../../sections.tsx";
import { CopyLink } from "../copy-link.tsx";

type Params = Promise<{ owner: string; slug: string }>;

/** Resolves the owner and the article together, or gives up. */
async function read(params: Params) {
  const { owner: key, slug } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) return null;

  const article = await getArticle(owner.key, slug);
  return article ? { owner, article } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const found = await read(params);
  if (!found) return {};

  const { owner, article } = found;
  const title = article.seo?.metaTitle ?? article.title;
  const description = article.seo?.metaDescription ?? article.summary ?? undefined;
  const share = article.seo?.shareImage ?? article.cover;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      publishedTime: article.publishedAt,
      url: `${ownerUrl(owner)}berita/${article.slug}`,
      images: share ? [mediaUrl(share)] : undefined,
    },
  };
}

/**
 * Blocking rather than instant, and a slug nobody owns answers 200, not 404.
 *
 * `[slug]` has no `generateStaticParams` — the set of articles changes whenever
 * an editor publishes — so reading it is runtime data, and the article is read
 * in the page body rather than streamed. `instant = false` says that out loud
 * instead of leaving the route flagged by validation.
 *
 * The status is the part worth knowing. Once a response starts streaming its
 * headers are gone, so `notFound()` firing after an `await` cannot turn 200 into
 * 404; Next injects `<meta name="robots" content="noindex">` instead, which is
 * what keeps a deleted article out of an index. A real 404 would need the answer
 * before any `await`, and the answer lives in the CMS. A path no page claims at
 * all is a different mechanism and does return 404 — see `global-not-found.tsx`.
 */
export const instant = false;

/**
 * One article, from either collection.
 *
 * A slug this owner has never published is `notFound()` rather than an empty
 * article: the address is one a page owns but holds no record for, which is the
 * not-found state the page map asks every data-backed page to handle.
 *
 * The umbrella carries no "Berita lainnya" row and no related achievement — it
 * publishes foundation-level notices, and pencapaian is a school's record.
 */
export default async function ArticlePage({ params }: { params: Params }) {
  const found = await read(params);
  if (!found) notFound();

  const { owner, article } = found;
  const school = SCHOOLS.find((candidate) => candidate.key === owner.key);

  return (
    <main>
      <Head article={article} />

      <section className={SECTION}>
        <div className={`${WIDTH} flex flex-col gap-8`}>
          <Photo image={article.cover} label="Sampul" className="aspect-video w-full" />

          <div className="flex flex-col gap-10 lg:flex-row lg:gap-12">
            <div className="flex-1">
              <Prose>{article.body}</Prose>
            </div>

            <div className="flex flex-col gap-6 lg:w-100 lg:shrink-0">
              <Suspense fallback={null}>
                <AchievementOrAdmission
                  ownerKey={owner.key}
                  schoolKey={school?.key}
                  slug={article.slug}
                />
              </Suspense>
              <Share owner={owner} article={article} />
            </div>
          </div>
        </div>
      </section>

      {school && (
        <Suspense fallback={null}>
          <MoreNews owner={owner} slug={article.slug} />
        </Suspense>
      )}
    </main>
  );
}

/** Where the visitor is, what this is, and when it was published. */
const Head = ({ article }: { article: FullArticle }) => (
  <section className={`${SECTION} pb-0 md:pb-0 lg:pb-0`}>
    <div className={`${WIDTH} flex flex-col gap-4`}>
      <nav aria-label="Remah roti" className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <a href="/" className="text-muted-foreground underline underline-offset-4">
          Beranda
        </a>
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <a href="/berita" className="text-muted-foreground underline underline-offset-4">
          Berita
        </a>
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <span className="text-muted-foreground">{article.title}</span>
      </nav>

      <span className="flex flex-wrap items-center gap-2.5">
        <Badge variant={article.kind === "Berita" ? "info" : "warning"}>{article.kind}</Badge>
        {/* Long form here, short form in the listing: one date format per
            context, spelled out where it sits in prose. */}
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatLongDate(article.publishedAt)}
        </span>
        {article.attribution && (
          <span className="text-sm text-muted-foreground">· {article.attribution}</span>
        )}
      </span>

      <h1 className="max-w-[22ch] text-[32px] leading-tight font-extrabold text-balance md:text-[44px]">
        {article.title}
      </h1>
      {article.summary && (
        <p className="max-w-[65ch] text-lg text-pretty text-muted-foreground">{article.summary}</p>
      )}
    </div>
  </section>
);

/**
 * What sits above the share links: the achievement this article tells the story
 * of, or the admission card when there is none.
 *
 * The canvas draws a school article with a pencapaian panel and the umbrella's
 * with an admission card, which is the same slot filled by whichever the page
 * has. The relation is opt-in from the achievement's side, so most articles have
 * none — and a sidebar that then held only "Bagikan" would leave the page with
 * no answer to what a reader does next.
 */
async function AchievementOrAdmission({
  ownerKey,
  schoolKey,
  slug,
}: {
  ownerKey: Owner["key"];
  schoolKey: SchoolKey | undefined;
  slug: string;
}) {
  // Only a school publishes pencapaian, and only a Berita can be linked to one.
  const achievement: Achievement | null = schoolKey
    ? await getRelatedAchievement(ownerKey, slug)
    : null;

  return achievement ? (
    <AchievementPanel achievement={achievement} />
  ) : (
    <AdmissionCardSection schoolKey={schoolKey} />
  );
}

const AchievementPanel = ({ achievement }: { achievement: Achievement }) => {
  return (
    <aside className="flex flex-col gap-1.5 rounded-xl border border-border p-5">
      <h2 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
        Pencapaian terkait
      </h2>
      <p className="text-sm font-bold text-pretty">{achievement.title}</p>
      <p className="text-[13px] text-muted-foreground capitalize tabular-nums">
        Tingkat {achievement.level} · {achievement.year}
      </p>
    </aside>
  );
};

/**
 * The ways to pass an article on.
 *
 * Absolute URLs, built from the owner's own host rather than from the browser:
 * WhatsApp and mail both need one, and this renders on the server where there is
 * no `window.location`. Each row is its own 44px target and carries a word —
 * an icon alone names nothing to a screen reader.
 */
const Share = ({ owner, article }: { owner: Owner; article: FullArticle }) => {
  const url = `${ownerUrl(owner)}berita/${article.slug}`;
  // No resting underline, unlike every other link in this app: the icon beside
  // each label is what carries the meaning without colour, which is the rule the
  // underline exists for. It appears on hover so the target still announces
  // itself as one.
  const row =
    "flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-primary underline-offset-4 hover:underline";

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted p-4 md:gap-2.5 md:p-5">
      <h2 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Bagikan</h2>
      {/* One row from tablet up, stacked on a phone — where three 44px targets
          side by side would each be too narrow to hit. */}
      <div className="flex flex-col gap-0.5 md:flex-row md:gap-5">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`${article.title} ${url}`)}`}
          target="_blank"
          rel="noreferrer"
          className={row}
        >
          <MessageCircle aria-hidden className="size-4.5 shrink-0" strokeWidth={1.75} />
          WhatsApp
        </a>
        {/* Width reserved for the longer of its two labels, but only in the row
            layout: "Salin tautan" becoming "Tersalin" would otherwise pull the
            Email link left for two seconds and drop it back. Stacked, the label
            changes width against nothing. */}
        <CopyLink url={url} className={`${row} md:min-w-25`} />
        <a
          href={`mailto:?subject=${encodeURIComponent(article.title)}&body=${encodeURIComponent(url)}`}
          className={row}
        >
          <Mail aria-hidden className="size-4.5 shrink-0" strokeWidth={1.75} />
          Email
        </a>
      </div>
    </div>
  );
};

/** Three more entries, newest first, minus the one being read. */
async function MoreNews({ owner, slug }: { owner: Owner; slug: string }) {
  const entries = (await getArticleIndex(owner.key))
    .filter((entry) => entry.slug !== slug)
    .slice(0, 3);

  if (entries.length === 0) return null;

  return (
    <section className={`${SECTION} bg-muted`}>
      <div className={`${WIDTH} flex flex-col gap-7`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <h2 className="text-[28px] font-bold text-balance">Berita lainnya</h2>
          <a
            href="/berita"
            className="flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary underline underline-offset-4"
          >
            Lihat semua berita
          </a>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <Card key={`${entry.kind}-${entry.slug}`} entry={entry} />
          ))}
        </div>
      </div>
    </section>
  );
}

const Card = ({ entry }: { entry: Article }) => (
  <a
    href={`/berita/${entry.slug}`}
    className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 hover:border-primary"
  >
    <Photo image={entry.cover} label="Sampul" className="aspect-3/2 w-full" inCard />
    <div className="flex flex-col gap-1.5 px-1 pb-1">
      <h3 className="text-[17px] font-bold text-pretty">{entry.title}</h3>
      {entry.summary && <p className="text-[13px] text-muted-foreground">{entry.summary}</p>}
      <p className="text-xs text-muted-foreground tabular-nums">
        {entry.kind} · {formatDate(entry.publishedAt)}
      </p>
    </div>
  </a>
);
