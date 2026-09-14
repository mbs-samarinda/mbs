import { SCHOOLS, type SchoolKey } from "@mbs/school-config";
import { Badge } from "@mbs/ui/components/badge";
import { buttonVariants } from "@mbs/ui/components/button";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getCycleFacts, isOpen } from "../../admission.ts";
import { getArticles, getPage, getSite, type Block, type Media } from "../../cms.ts";
import { OWNERS, type Owner } from "../../owners.ts";
import {
  AdmissionBandSection,
  Fact,
  FactStrip,
  Photo,
  SectionHeading,
  formatDate,
  formatFee,
  SECTION,
  WIDTH,
} from "./sections.tsx";

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

function BlockSection({
  block,
  owner,
  schoolKey,
  admissionCta,
}: {
  block: Block;
  owner: Owner;
  schoolKey: SchoolKey | undefined;
  admissionCta: string;
}) {
  switch (block.kind) {
    case "hero":
      return (
        <Hero
          heading={block.heading}
          body={block.body}
          image={block.image}
          schoolKey={schoolKey}
          admissionCta={admissionCta}
        />
      );

    case "image-text":
      return (
        <section className={`${SECTION} bg-muted`}>
          <div
            className={`${WIDTH} flex flex-col gap-8 md:flex-row md:items-center ${block.imageSide === "akhir" ? "md:flex-row-reverse" : ""}`}
          >
            <Photo image={block.image} label="Foto" className="aspect-4/3 w-full md:w-72" />
            <div className="flex flex-col gap-3">
              {block.heading && (
                <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                  {block.heading}
                </p>
              )}
              {/* ponytail: the field is Strapi `richtext`, rendered here as
                  plain text, so an editor who bolds a word ships a literal
                  `**word**`. Render it through a markdown parser when the first
                  page needs formatted body copy — `/profil` is the one that
                  will. */}
              <p className="max-w-[65ch] text-lg font-semibold text-pretty">{block.body}</p>
            </div>
          </div>
        </section>
      );

    case "programs":
      return (
        <section className={SECTION}>
          <div className={`${WIDTH} flex flex-col gap-7`}>
            <SectionHeading head={block.head} />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {block.items.map((item) => (
                <article
                  key={item.title}
                  className="flex flex-col gap-2 rounded-xl border border-border p-4"
                >
                  <h3 className="text-[17px] font-bold text-pretty">{item.title}</h3>
                  {item.description && (
                    <p className="text-[13px] text-muted-foreground">{item.description}</p>
                  )}
                  {item.points && (
                    <ul className="flex flex-col gap-1 text-[13px] text-muted-foreground">
                      {/* `\r?\n`, because text authored on Windows leaves a
                          trailing carriage return that `filter(Boolean)` does
                          not catch — it renders as a blank bullet. */}
                      {item.points
                        .split(/\r?\n/)
                        .map((point) => point.trim())
                        .filter(Boolean)
                        .map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      );

    case "facilities":
    case "extracurriculars": {
      const base = block.kind === "facilities" ? "/fasilitas" : "/ekstrakurikuler";
      return (
        <section className={`${SECTION} ${base === "/fasilitas" ? "bg-muted" : ""}`}>
          <div className={`${WIDTH} flex flex-col gap-7`}>
            <SectionHeading head={block.head} />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {block.items.map((item) => (
                <a
                  key={item.slug}
                  href={`${base}/${item.slug}`}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 hover:border-primary"
                >
                  <Photo
                    image={item.images[0] ?? null}
                    label="Foto"
                    className="aspect-3/2 w-full"
                    inCard
                  />
                  <div className="flex flex-col gap-1 px-1 pb-1">
                    <h3 className="text-[17px] font-bold text-pretty">{item.title}</h3>
                    {item.summary && (
                      <p className="text-[13px] text-muted-foreground">{item.summary}</p>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      );
    }

    case "achievements":
      return (
        <section className={SECTION}>
          <div className={`${WIDTH} flex flex-col gap-7`}>
            <SectionHeading head={block.head} />
            <ul className="flex flex-col">
              {block.items.map((item) => (
                <li
                  key={item.slug}
                  className="flex flex-col gap-1 border-b border-border py-4 md:flex-row md:items-baseline md:gap-6"
                >
                  <span className="flex items-center gap-2.5">
                    <Badge variant="secondary" className="capitalize">
                      {item.level}
                    </Badge>
                    <span className="text-sm font-semibold tabular-nums">{item.year}</span>
                  </span>
                  <span className="flex-1 text-sm font-semibold text-pretty">{item.title}</span>
                  <span className="text-[13px] text-muted-foreground">{item.recipient}</span>
                  {item.berita && (
                    <a
                      href={`/berita/${item.berita.slug}`}
                      className="text-[13px] font-semibold text-primary underline underline-offset-4"
                    >
                      Baca ceritanya
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      );

    case "news":
      return (
        <section className={`${SECTION} bg-muted`}>
          <div className={`${WIDTH} flex flex-col gap-7`}>
            <SectionHeading head={block.head} />
            {/* Streamed, because the expiry cut is read against the real clock:
                a notice that expired at 10:05 has to be gone at 10:05, not when
                the cache next refills. The articles themselves are cached; only
                the cut is live. */}
            <Suspense fallback={<NewsPlaceholder count={block.limit} />}>
              <NewsGrid ownerKey={owner.key} limit={block.limit} />
            </Suspense>
          </div>
        </section>
      );

    // The band is rendered by the page itself, not from the zone, so an editor
    // cannot delete the admission path by deleting a block. A block placed here
    // anyway is a duplicate of it. Blocks this page does not draw — text, FAQ,
    // contact — land here too and render nothing until the page that owns them
    // exists.
    default:
      return null;
  }
}

// Holds the row's height while the listing streams in, and does not animate:
// nothing in this system repaints continuously.
const NewsPlaceholder = ({ count }: { count: number }) => (
  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: count }, (_, index) => (
      <span key={index} className="h-64 rounded-xl border border-border bg-muted" />
    ))}
  </div>
);

async function NewsGrid({ ownerKey, limit }: { ownerKey: Owner["key"]; limit: number }) {
  const articles = await getArticles(ownerKey, limit);

  if (articles.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada berita atau pengumuman.</p>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {articles.map((article) => (
        <a
          key={`${article.kind}-${article.slug}`}
          // Both types live under `/berita`, which is one listing over two
          // collections. `/berita/[slug]` therefore has to look in both; the
          // CMS's `uniqueSlugPerOwner` lifecycle already treats them as one
          // address space, so a slug cannot mean two articles on one site.
          href={`/berita/${article.slug}`}
          className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 hover:border-primary"
        >
          <Photo image={article.cover} label="Sampul" className="aspect-3/2 w-full" inCard />
          <div className="flex flex-col gap-1.5 px-1 pb-1">
            <span className="flex items-center gap-2">
              {/* The type is named rather than implied: the mix leans to
                  notices, and a listing that called everything "Berita" would
                  be named after the emptier of its two types. The two status
                  pairs the canvas gives them — Information and Warning — are
                  shared and fixed, so they stay teal and amber on every owner's
                  site, including SMK's blue one. */}
              <Badge variant={article.kind === "Berita" ? "info" : "warning"}>{article.kind}</Badge>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDate(article.publishedAt)}
              </span>
            </span>
            <h3 className="text-[17px] font-bold text-pretty">{article.title}</h3>
            {article.summary && (
              <p className="text-[13px] text-muted-foreground">{article.summary}</p>
            )}
          </div>
        </a>
      ))}
    </div>
  );
}

function Hero({
  heading,
  body,
  image,
  schoolKey,
  admissionCta,
}: {
  heading: string;
  body: string | null;
  image: Media | null;
  schoolKey: SchoolKey | undefined;
  admissionCta: string;
}) {
  return (
    <section className={SECTION}>
      <div className={`${WIDTH} flex flex-col gap-10 lg:flex-row lg:items-center lg:gap-16`}>
        <div className="flex flex-col gap-5 lg:flex-1">
          {schoolKey && (
            <Suspense fallback={<StatusPlaceholder />}>
              <CycleStatus schoolKey={schoolKey} />
            </Suspense>
          )}
          <h1 className="text-[32px] leading-tight font-extrabold text-balance md:text-[44px]">
            {heading}
          </h1>
          {body && (
            <p className="max-w-[65ch] text-base text-pretty text-muted-foreground">{body}</p>
          )}
          <div className="flex flex-wrap gap-3">
            <a href="/pendaftaran" className={buttonVariants({ size: "touch" })}>
              {admissionCta}
            </a>
          </div>
          {schoolKey && (
            <Suspense fallback={<FactsPlaceholder count={3} />}>
              <HeroFacts schoolKey={schoolKey} />
            </Suspense>
          )}
        </div>
        <Photo image={image} label="Foto sekolah" className="aspect-4/3 lg:flex-1" />
      </div>
    </section>
  );
}

// A skeleton that holds the row's height and does not animate: nothing in this
// system repaints continuously.
const StatusPlaceholder = () => <span className="h-6 w-52 rounded-4xl bg-muted" />;
const FactsPlaceholder = ({ count }: { count: number }) => (
  <div className="flex flex-wrap gap-x-8 gap-y-3">
    {Array.from({ length: count }, (_, index) => (
      <span key={index} className="flex h-8 w-28 flex-col justify-center rounded-md bg-muted" />
    ))}
  </div>
);

async function CycleStatus({ schoolKey }: { schoolKey: SchoolKey }) {
  const facts = await getCycleFacts(schoolKey);
  if (facts.state !== "cycle") return null;

  const open = isOpen(facts.cycle);
  return (
    <Badge variant={open ? "default" : "secondary"} className="h-6 w-fit px-2.5">
      Pendaftaran {facts.cycle.name} {open ? "dibuka" : "ditutup"}
    </Badge>
  );
}

async function HeroFacts({ schoolKey }: { schoolKey: SchoolKey }) {
  const facts = await getCycleFacts(schoolKey);
  if (facts.state !== "cycle") return null;

  return (
    <FactStrip>
      <Fact label={isOpen(facts.cycle) ? "Ditutup" : "Dibuka"}>
        {formatDate(
          isOpen(facts.cycle) ? facts.cycle.registrationCloseAt : facts.cycle.registrationOpenAt,
        )}
      </Fact>
      <Fact label="Biaya sekolah">{formatFee(facts.cycle.effectiveFee)}</Fact>
      <Fact label="Hasil diumumkan">{formatDate(facts.cycle.resultPublishAt)}</Fact>
    </FactStrip>
  );
}
