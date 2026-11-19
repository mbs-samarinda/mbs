import Link from "next/link";

import { getEntries, type Entry, type EntryCollection, type FullEntry } from "@/cms/entries.ts";
import { type Owner } from "@/owners.ts";

import { PendingSpinner } from "./pending-spinner.tsx";
import { Photo, WIDTH, SECTION, photoTransition } from "./section.tsx";

/**
 * The two collections whose records own a page, and the words each wears.
 *
 * One record rather than a prop per string: an activity page and a facility page
 * are the same page over different rows, and the only thing that differs between
 * them is what the section is called. Adding a third collection is one entry
 * here, not a third copy of the layout.
 */
export const ENTRY_SECTIONS = {
  "ekstrakurikuler-list": {
    base: "/ekstrakurikuler",
    label: "Ekstrakurikuler",
    more: "Kegiatan lain",
    all: "Lihat semua kegiatan",
  },
  "fasilitas-list": {
    base: "/fasilitas",
    label: "Fasilitas",
    more: "Fasilitas lain",
    all: "Lihat semua fasilitas",
  },
} as const satisfies Record<EntryCollection, unknown>;

/**
 * Where the visitor is, what this is, and the one line that summarises it.
 *
 * Takes only what it draws, so an album page — which is not an entry — opens
 * the same way.
 */
export const EntryHead = ({
  entry,
  section,
}: {
  entry: Pick<FullEntry, "title" | "summary">;
  section: { readonly base: string; readonly label: string };
}) => (
  <section className={`${SECTION} pb-0 md:pb-0 lg:pb-0`}>
    <div className={`${WIDTH} flex flex-col gap-4`}>
      <nav aria-label="Remah roti" className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <Link href="/" className="text-muted-foreground underline underline-offset-4">
          Beranda
        </Link>
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <Link href={section.base} className="text-muted-foreground underline underline-offset-4">
          {section.label}
        </Link>
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
 * How the thing actually runs, beside the description.
 *
 * One `dl` with a single `div` per pair: HTML allows exactly that much between a
 * `dl` and its pairs, and a second level leaves every `dt`/`dd` without a valid
 * parent — a screen reader then reads loose strings instead of labelled facts.
 * Same rule the fact lists on `/profil` follow.
 *
 * The labels are the editor's, not fields: an activity has a Pembina and a
 * facility has a Kapasitas, and one repeatable draws both.
 */
export const EntryFacts = ({ facts }: { facts: FullEntry["facts"] }) => (
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
 * Three more of the same kind, and the way back to all of them.
 *
 * Alphabetical like the listing rather than a recommendation: these sites carry
 * a handful of each, and anything cleverer would be a ranking nobody asked for.
 * The section is dropped when this is the only record published.
 */
export async function MoreEntries({
  ownerKey,
  collection,
  slug,
}: {
  ownerKey: Owner["key"];
  collection: EntryCollection;
  slug: string;
}) {
  const section = ENTRY_SECTIONS[collection];
  const others = (await getEntries(ownerKey, collection))
    .filter((entry) => entry.slug !== slug)
    .slice(0, 3);

  if (others.length === 0) return null;

  return (
    <section className={`${SECTION} bg-muted`}>
      <div className={`${WIDTH} flex flex-col gap-7`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <h2 className="text-[28px] font-bold text-balance">{section.more}</h2>
          <Link
            href={section.base}
            className="flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary underline underline-offset-4"
          >
            {section.all}
          </Link>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {others.map((entry) => (
            <EntryCard key={entry.slug} entry={entry} base={section.base} />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * One activity or facility on its collection's listing, and in the row of others
 * at the foot of a detail page.
 *
 * The photograph is flush to the card's edge rather than inset, which the
 * homepage's own cards are not — so the radius baked into `Photo` has to be
 * overridden here, and `!` is what makes that deterministic: both classes set
 * `border-radius`, and which one wins otherwise depends on Tailwind's own
 * ordering rather than on the order written here. The card clips, so the corners
 * a visitor sees are the card's.
 */
export const EntryCard = ({
  entry,
  base,
  travels = false,
}: {
  entry: Entry;
  base: string;
  /**
   * The photo carries into the page the card opens. Off in the row of others at
   * the foot of a detail page: that row lists the page being left, so its hero
   * and this card's photo would cross on the way.
   */
  travels?: boolean;
}) => (
  <Link
    href={`${base}/${entry.slug}`}
    className="relative flex flex-col overflow-hidden rounded-xl border border-border bg-background hover:border-primary"
  >
    <PendingSpinner />
    <Photo
      image={entry.images[0] ?? null}
      label="Foto"
      className="aspect-43/20 w-full rounded-none!"
      inCard
      transition={travels ? photoTransition(base, entry.slug) : undefined}
    />
    <div className="flex flex-col gap-1.5 p-4.5">
      <h3 className="text-[17px] font-bold text-pretty">{entry.title}</h3>
      {entry.summary && <p className="text-[13px] text-muted-foreground">{entry.summary}</p>}
      {entry.meta && (
        <p className="text-xs font-semibold text-primary tabular-nums">{entry.meta}</p>
      )}
    </div>
  </Link>
);
