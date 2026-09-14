import { SCHOOLS, type SchoolKey } from "@mbs/school-config";
import { Badge } from "@mbs/ui/components/badge";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  filterArticles,
  isArticleType,
  monthsOf,
  pageParam,
  paginate,
  type ArticleType,
  type Month,
} from "../../../articles.ts";
import { getArticleIndex, getPage, type Article } from "../../../cms.ts";
import { OWNERS, type Owner } from "../../../owners.ts";
import { AdmissionCardSection, PageHead, Photo, SECTION, WIDTH, formatDate } from "../sections.tsx";

/** What the listing reads out of the URL. The params stay English; the copy does not. */
type Params = {
  type?: string | undefined;
  month?: string | undefined;
  page?: string | undefined;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) return {};

  const page = await getPage(owner.key, "berita");
  return {
    title: page?.seo?.metaTitle ?? "Berita & Pengumuman",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

/**
 * One listing over two collections, newest first.
 *
 * The type is named on every row rather than implied: across both previous
 * school sites there were no real Berita at all, and the one article that
 * existed was a Pengumuman. A listing that called everything "Berita" would be
 * named after the emptier of its two types.
 *
 * The page head is outside the `<Suspense>` boundary and the whole `Isi` section
 * is inside it, which is what keeps the shell prerendering: the filter reads
 * `searchParams` and the expiry cut reads the clock, and both of those live in
 * the streamed part.
 */
export default async function BeritaPage({
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
        heading="Berita & Pengumuman"
        body={
          school
            ? "Satu daftar, dua jenis. Terbaru lebih dulu."
            : "Kabar tingkat yayasan dan kampanye pendaftaran bersama."
        }
      />

      <Suspense fallback={<ListingPlaceholder hasSidebar={Boolean(school)} />}>
        <Listing owner={owner} schoolKey={school?.key} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Listing({
  owner,
  schoolKey,
  searchParams,
}: {
  owner: Owner;
  schoolKey: SchoolKey | undefined;
  searchParams: Promise<Params>;
}) {
  // The umbrella's listing runs full width: it has no admission cycle of its
  // own, and an archive beside four entries is furniture.
  const hasSidebar = Boolean(schoolKey);
  const [{ type, month: requested, page }, entries] = await Promise.all([
    searchParams,
    getArticleIndex(owner.key),
  ]);

  const active = isArticleType(type) ? type : undefined;
  // The archive counts the type the visitor is looking at, so the number beside
  // a month is the number of entries that link actually renders.
  const inType = filterArticles(entries, { type: active });
  const months = monthsOf(inType);
  // A month nobody published in is dropped rather than honoured, the same way a
  // bad `?type=` and a bad `?page=` are. An arsip link whose last entry has since
  // expired would otherwise render "Belum ada berita atau pengumuman." at 200 —
  // a page that reads as a school which publishes nothing.
  const month = months.some((entry) => entry.key === requested) ? requested : undefined;
  const listing = paginate(filterArticles(inType, { month }), pageParam(page));

  const href = (next: Partial<Params>) => {
    const query = new URLSearchParams();
    const merged = { type: active, month, ...next };
    if (merged.type) query.set("type", merged.type);
    if (merged.month) query.set("month", merged.month);
    if (merged.page && merged.page !== "1") query.set("page", merged.page);
    const search = query.toString();
    return search ? `/berita?${search}` : "/berita";
  };

  return (
    <section className={SECTION}>
      <div className={`${WIDTH} flex flex-col gap-6`}>
        <Filter active={active} month={month} href={href} />

        <div className={`flex flex-col gap-10 ${hasSidebar ? "lg:flex-row lg:gap-8" : ""}`}>
          <div className="flex flex-1 flex-col gap-6">
            {listing.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada berita atau pengumuman.</p>
            ) : (
              <ul className="flex flex-col">
                {listing.entries.map((entry) => (
                  <Row key={`${entry.kind}-${entry.slug}`} entry={entry} />
                ))}
              </ul>
            )}
            <Pages listing={listing} href={href} />
          </div>

          {hasSidebar && (
            <div className="flex flex-col gap-4 lg:w-80 lg:shrink-0">
              <AdmissionCardSection schoolKey={schoolKey} />
              <Archive months={months} active={month} href={href} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** The type label's own colour, from the shared status pairs. */
const TYPE_VARIANT = { Berita: "info", Pengumuman: "warning" } as const;

const Row = ({ entry }: { entry: Article }) => (
  <li className="border-b border-border first:border-t">
    <a
      href={`/berita/${entry.slug}`}
      className="flex flex-col gap-3 py-5 hover:opacity-90 md:flex-row md:items-start md:gap-5"
    >
      <Photo image={entry.cover} label="Sampul" className="aspect-3/2 w-full md:w-50 md:shrink-0" />
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2">
          <Badge variant={TYPE_VARIANT[entry.kind]}>{entry.kind}</Badge>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDate(entry.publishedAt)}
          </span>
        </span>
        <h2 className="text-lg font-bold text-pretty">{entry.title}</h2>
        {entry.summary && (
          <p className="max-w-[70ch] text-sm text-pretty text-muted-foreground">{entry.summary}</p>
        )}
      </div>
    </a>
  </li>
);

/**
 * The type filter, as links rather than a control.
 *
 * Links because the state belongs in the URL — it survives a refresh, it can be
 * shared, and a crawler can follow it — and because a filter built this way
 * needs no JavaScript at all. Selection is carried by `aria-current` as well as
 * the fill, since colour alone names nothing.
 */
const Filter = ({
  active,
  month,
  href,
}: {
  active: ArticleType | undefined;
  month: string | undefined;
  href: (next: Partial<Params>) => string;
}) => (
  <nav aria-label="Saring menurut jenis" className="flex flex-wrap gap-2">
    {(
      [
        [undefined, "Semua"],
        ["berita", "Berita"],
        ["pengumuman", "Pengumuman"],
      ] as const
    ).map(([value, label]) => (
      <a
        key={label}
        // The page resets with the filter: page 3 of everything is rarely page 3
        // of one type, and a filter that lands on an empty page reads as a type
        // with no entries.
        href={href({ type: value, month, page: "1" })}
        aria-current={active === value ? "page" : undefined}
        className={`flex min-h-11 items-center rounded-4xl border px-4 text-sm font-semibold ${
          active === value
            ? "border-foreground bg-foreground text-background"
            : "border-border hover:bg-muted"
        }`}
      >
        {label}
      </a>
    ))}
  </nav>
);

/**
 * The months that hold entries, with exact counts.
 *
 * Counted from the same cut list the page renders, so a month that says three
 * shows three. An expired notice is gone from both.
 */
const Archive = ({
  months,
  active,
  href,
}: {
  months: readonly Month[];
  active: string | undefined;
  href: (next: Partial<Params>) => string;
}) =>
  months.length === 0 ? null : (
    <nav aria-label="Arsip" className="flex flex-col gap-1 rounded-xl border border-border p-5">
      <h2 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Arsip</h2>
      {months.map((entry) => (
        <a
          key={entry.key}
          href={href({ month: active === entry.key ? undefined : entry.key, page: "1" })}
          aria-current={active === entry.key ? "page" : undefined}
          className={`flex min-h-11 items-center text-sm tabular-nums underline-offset-4 hover:underline ${
            active === entry.key ? "font-bold text-primary" : ""
          }`}
        >
          {entry.label} ({entry.count})
        </a>
      ))}
    </nav>
  );

/** Numbered pages. Absent until there is more than one, where it would say nothing. */
const Pages = ({
  listing,
  href,
}: {
  listing: { page: number; pages: number };
  href: (next: Partial<Params>) => string;
}) =>
  listing.pages < 2 ? null : (
    <nav aria-label="Halaman" className="flex flex-wrap gap-2">
      {Array.from({ length: listing.pages }, (_, index) => index + 1).map((page) => (
        <a
          key={page}
          href={href({ page: String(page) })}
          aria-current={page === listing.page ? "page" : undefined}
          className={`flex size-11 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums ${
            page === listing.page
              ? "border-foreground bg-foreground text-background"
              : "border-border hover:bg-muted"
          }`}
        >
          {page}
        </a>
      ))}
    </nav>
  );

// Holds the listing's shape while it streams — the sidebar column included, or
// the rows reflow sideways the moment it lands, which is the shift a placeholder
// exists to prevent. It does not animate: nothing in this system repaints
// continuously.
const ListingPlaceholder = ({ hasSidebar }: { hasSidebar: boolean }) => (
  <section className={SECTION}>
    <div className={`${WIDTH} flex flex-col gap-6`}>
      <span className="h-11 w-64 rounded-4xl bg-muted" />
      <div className={`flex flex-col gap-10 ${hasSidebar ? "lg:flex-row lg:gap-8" : ""}`}>
        <div className="flex flex-1 flex-col">
          {Array.from({ length: 5 }, (_, index) => (
            <span key={index} className="h-42 border-b border-border first:border-t" />
          ))}
        </div>
        {hasSidebar && <span className="h-64 rounded-xl bg-muted lg:w-80 lg:shrink-0" />}
      </div>
    </div>
  </section>
);
