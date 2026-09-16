import { SCHOOLS } from "@mbs/school-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getEntries, getEntry, mediaUrl, type FullEntry } from "../../../../cms.ts";
import { OWNERS, ownerUrl, type Owner } from "../../../../owners.ts";
import { Prose } from "../../prose.tsx";
import { EntryCard, Photo, SECTION, WIDTH } from "../../sections.tsx";

type Params = Promise<{ owner: string; slug: string }>;

/** Resolves the school and the activity together, or gives up. */
async function read(params: Params) {
  const { owner: key, slug } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  const school = SCHOOLS.find((candidate) => candidate.key === key);
  if (!owner || !school) return null;

  const entry = await getEntry(owner.key, "ekstrakurikuler-list", slug);
  return entry ? { owner, entry } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const found = await read(params);
  if (!found) return {};

  const { owner, entry } = found;
  const title = entry.seo?.metaTitle ?? entry.title;
  const description = entry.seo?.metaDescription ?? entry.summary ?? undefined;
  const share = entry.seo?.shareImage ?? entry.images[0];

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${ownerUrl(owner)}ekstrakurikuler/${entry.slug}`,
      images: share ? [mediaUrl(share)] : undefined,
    },
  };
}

/**
 * Blocking, and a slug nobody owns answers 200 rather than 404 — the same two
 * facts `/berita/[slug]` records at length. There is no `generateStaticParams`
 * because the set of activities changes whenever an editor publishes, and once a
 * response has started streaming its headers are gone, so `notFound()` after an
 * `await` can only add `<meta name="robots" content="noindex">`. That is what
 * keeps a deleted activity out of a search index.
 */
export const instant = false;

/** One activity: what it is, how it runs, and what else a visitor could look at. */
export default async function EkstrakurikulerDetailPage({ params }: { params: Params }) {
  const found = await read(params);
  if (!found) notFound();

  const { owner, entry } = found;

  return (
    <main>
      <Head entry={entry} />

      <section className={SECTION}>
        <div className={`${WIDTH} flex flex-col gap-8`}>
          <Photo image={entry.images[0] ?? null} label="Foto" className="aspect-20/7 w-full" />

          <div className="flex flex-col gap-10 lg:flex-row lg:gap-12">
            <div className="flex-1">
              <Prose>{entry.body}</Prose>
            </div>

            {entry.facts.length > 0 && <Facts facts={entry.facts} />}
          </div>
        </div>
      </section>

      <MoreActivities ownerKey={owner.key} slug={entry.slug} />
    </main>
  );
}

/** Where the visitor is, what this is, and the one line that summarises it. */
const Head = ({ entry }: { entry: FullEntry }) => (
  <section className={`${SECTION} pb-0 md:pb-0 lg:pb-0`}>
    <div className={`${WIDTH} flex flex-col gap-4`}>
      <nav aria-label="Remah roti" className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <a href="/" className="text-muted-foreground underline underline-offset-4">
          Beranda
        </a>
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <a href="/ekstrakurikuler" className="text-muted-foreground underline underline-offset-4">
          Ekstrakurikuler
        </a>
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <span className="text-muted-foreground">{entry.title}</span>
      </nav>

      <h1 className="max-w-[22ch] text-[32px] leading-tight font-extrabold text-balance md:text-[44px]">
        {entry.title}
      </h1>
      {entry.summary && (
        <p className="max-w-[65ch] text-lg text-pretty text-muted-foreground">{entry.summary}</p>
      )}
    </div>
  </section>
);

/**
 * How the activity actually runs, beside the description.
 *
 * One `dl` with a single `div` per pair: HTML allows exactly that much between a
 * `dl` and its pairs, and a second level leaves every `dt`/`dd` without a valid
 * parent — a screen reader then reads loose strings instead of labelled facts.
 * Same rule the fact lists on `/profil` follow.
 */
const Facts = ({ facts }: { facts: FullEntry["facts"] }) => (
  <dl className="flex flex-col rounded-xl border border-border lg:w-90 lg:shrink-0">
    {facts.map((fact, index) => (
      <div
        key={fact.id}
        className={`flex flex-col gap-1 px-4.5 py-3.5 sm:flex-row sm:items-baseline sm:gap-4 ${
          index === 0 ? "" : "border-t border-border"
        }`}
      >
        <dt className="text-[13px] text-muted-foreground sm:w-30 sm:shrink-0">{fact.label}</dt>
        <dd className="text-sm font-medium text-pretty tabular-nums">{fact.value}</dd>
      </div>
    ))}
  </dl>
);

/**
 * Three more activities, and the way back to all of them.
 *
 * Alphabetical like the listing rather than a recommendation: these sites carry
 * a handful of activities, and anything cleverer would be a ranking nobody asked
 * for. The section is dropped when this is the only activity published.
 */
async function MoreActivities({ ownerKey, slug }: { ownerKey: Owner["key"]; slug: string }) {
  const others = (await getEntries(ownerKey, "ekstrakurikuler-list"))
    .filter((entry) => entry.slug !== slug)
    .slice(0, 3);

  if (others.length === 0) return null;

  return (
    <section className={`${SECTION} bg-muted`}>
      <div className={`${WIDTH} flex flex-col gap-7`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <h2 className="text-[28px] font-bold text-balance">Kegiatan lain</h2>
          <a
            href="/ekstrakurikuler"
            className="flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary underline underline-offset-4"
          >
            Lihat semua kegiatan
          </a>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {others.map((entry) => (
            <EntryCard key={entry.slug} entry={entry} base="/ekstrakurikuler" />
          ))}
        </div>
      </div>
    </section>
  );
}
