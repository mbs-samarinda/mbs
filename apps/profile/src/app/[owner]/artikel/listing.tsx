import type { SchoolKey } from "@mbs/school-config";

import {
  ARTICLE_KINDS,
  ARTICLE_TYPES,
  filterArticles,
  isArticleType,
  monthsOf,
  pageParam,
  paginate,
  type ArticleType,
  type Month,
} from "../../../articles.ts";
import { getArticleIndex, type Article } from "../../../cms.ts";
import { OWNERS, type Owner } from "../../../owners.ts";
import {
  AdmissionCardSection,
  ArticleMeta,
  Photo,
  SECTION,
  WIDTH,
  articleHref,
} from "../sections.tsx";

/** What the listing reads out of the URL. The params stay English; the copy does not. */
export type Params = {
  type?: string | undefined;
  month?: string | undefined;
  /** Apex only: a school's own site is already that school. */
  owner?: string | undefined;
  page?: string | undefined;
};

/** The apex's owner chips: the three schools, then the umbrella's own articles. */
const OWNER_FILTERS = [...OWNERS.slice(1), OWNERS[0]];

/**
 * The article listing, for `/artikel`, for each `/artikel/<type>`, and for the
 * apex home.
 *
 * On a school site it carries a sidebar with the admission card and the month
 * archive. The apex has neither — it takes no applications and is a menu, not
 * an archive — and filters by owner instead, so a reader can narrow to one
 * school without leaving. Every card still opens on its owner's own site.
 *
 * Given a `type`, it lists that one and drops the type chips, since the address
 * already says which. Without one it lists all three and the chips filter in
 * place through `?type=`. Both stay inside `<Suspense>` on their page: the
 * filter reads `searchParams` and the expiry cut reads the clock.
 */
export async function Listing({
  owner,
  schoolKey,
  type: fixed,
  searchParams,
}: {
  owner: Owner;
  schoolKey: SchoolKey | undefined;
  type?: ArticleType;
  searchParams: Promise<Params>;
}) {
  const [{ type, month: requested, owner: requestedOwner, page }, entries] = await Promise.all([
    searchParams,
    getArticleIndex(owner.key),
  ]);

  const active = fixed ?? (isArticleType(type) ? type : undefined);
  const byOwner = schoolKey
    ? undefined
    : OWNER_FILTERS.find((candidate) => candidate.key === requestedOwner)?.key;
  // The archive counts the type the visitor is looking at, so the number beside
  // a month is the number of entries that link actually renders.
  const inType = filterArticles(entries, { type: active, owner: byOwner });
  const months = monthsOf(inType);
  // A month nobody published in is dropped rather than honoured, and the apex,
  // which has no archive to show or clear one, honours none at all, the same way a
  // bad `?type=` and a bad `?page=` are. An arsip link whose last entry has since
  // expired would otherwise render "Belum ada artikel." at 200 —
  // a page that reads as a school which publishes nothing.
  const month =
    schoolKey && months.some((entry) => entry.key === requested) ? requested : undefined;
  const listing = paginate(filterArticles(inType, { month }), pageParam(page));

  // The apex lists on its home, so a filter link lands back on the list rather
  // than at the top of the school cards.
  const [base, anchor] = !schoolKey
    ? ["/", "#artikel"]
    : [fixed ? `/artikel/${fixed}` : "/artikel", ""];
  const href = (next: Partial<Params>) => {
    const query = new URLSearchParams();
    const merged = { type: active, month, owner: byOwner, ...next };
    if (merged.type && !fixed) query.set("type", merged.type);
    if (merged.month) query.set("month", merged.month);
    if (merged.owner) query.set("owner", merged.owner);
    if (merged.page && merged.page !== "1") query.set("page", merged.page);
    const search = query.toString();
    return `${search ? `${base}?${search}` : base}${anchor}`;
  };

  return (
    // The scroll margin clears the sticky two-row header when a filter link
    // jumps here.
    <section id={schoolKey ? undefined : "artikel"} className={`${SECTION} scroll-mt-28`}>
      <div className={`${WIDTH} flex flex-col gap-6`}>
        {!schoolKey && <h2 className="text-[28px] font-bold">Artikel</h2>}
        {/* Twice the gap between the two chip groups as within one, so on a
            phone, where they wrap, the owner chips do not read as more types. */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-4">
          {!fixed && <Filter active={active} month={month} href={href} />}
          {!schoolKey && <OwnerFilter active={byOwner} href={href} />}
        </div>

        <div className="flex flex-col gap-10 lg:flex-row lg:gap-8">
          <div className="flex flex-1 flex-col gap-6">
            {listing.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada {active ? ARTICLE_KINDS[active].toLowerCase() : "artikel"}
                {byOwner &&
                  ` dari ${OWNER_FILTERS.find((candidate) => candidate.key === byOwner)?.level}`}
                .
              </p>
            ) : (
              <ul className="flex flex-col">
                {listing.entries.map((entry) => (
                  <Row
                    key={`${entry.type}-${entry.ownerKey}-${entry.slug}`}
                    entry={entry}
                    site={owner.key}
                    nested={!schoolKey}
                  />
                ))}
              </ul>
            )}
            <Pages listing={listing} href={href} />
          </div>

          {schoolKey && (
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

/** `nested` puts the title under the apex's own "Artikel" heading, one level down. */
const Row = ({ entry, site, nested }: { entry: Article; site: Owner["key"]; nested: boolean }) => {
  const Title = nested ? "h3" : "h2";
  return (
    <li className="border-b border-border first:border-t">
      <a
        href={articleHref(entry, site)}
        className="flex flex-col gap-3 py-5 hover:opacity-90 md:flex-row md:items-start md:gap-5"
      >
        <Photo
          image={entry.cover}
          label="Sampul"
          className="aspect-3/2 w-full md:w-50 md:shrink-0"
        />
        <div className="flex flex-col gap-1.5">
          <ArticleMeta article={entry} site={site} />
          <Title className="text-lg font-bold text-pretty">{entry.title}</Title>
          {entry.summary && (
            <p className="max-w-[70ch] text-sm text-pretty text-muted-foreground">
              {entry.summary}
            </p>
          )}
        </div>
      </a>
    </li>
  );
};

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
    {[undefined, ...ARTICLE_TYPES].map((value) => (
      <a
        key={value ?? "semua"}
        // The page resets with the filter: page 3 of everything is rarely page 3
        // of one type, and a filter that lands on an empty page reads as a type
        // with no entries.
        href={href({ type: value, month, page: "1" })}
        aria-current={active === value ? "page" : undefined}
        className={pill(active === value)}
      >
        {value ? ARTICLE_KINDS[value] : "Semua"}
      </a>
    ))}
  </nav>
);

/**
 * One filter link. Shared so the type and owner rows can never drift apart.
 *
 * Presses like the shared `Button`, so a tap is acknowledged before the page
 * reloads. Reduced motion keeps the colour fade and drops the press.
 */
const pill = (on: boolean) =>
  `flex min-h-11 items-center rounded-4xl border px-4 text-sm font-semibold transition-[color,background-color,border-color,scale] duration-150 ease-out active:scale-[0.96] motion-reduce:active:scale-100 ${
    on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted"
  }`;

/** The apex's owner filter, one owner at a time, built like the type filter. */
const OwnerFilter = ({
  active,
  href,
}: {
  active: Owner["key"] | undefined;
  href: (next: Partial<Params>) => string;
}) => (
  <nav aria-label="Saring menurut sekolah" className="flex flex-wrap gap-2">
    {[undefined, ...OWNER_FILTERS].map((owner) => (
      <a
        key={owner?.key ?? "semua"}
        href={href({ owner: owner?.key, page: "1" })}
        aria-current={active === owner?.key ? "page" : undefined}
        className={pill(active === owner?.key)}
      >
        {owner?.level ?? "Semua sekolah"}
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
export const ListingPlaceholder = ({
  hasSidebar,
  hasFilters,
}: {
  hasSidebar: boolean;
  hasFilters: boolean;
}) => (
  <section className={SECTION}>
    <div className={`${WIDTH} flex flex-col gap-6`}>
      {/* The apex's listing opens with its own heading; a school page's title
          sits outside the boundary. */}
      {!hasSidebar && <span className="h-9 w-32 rounded-md bg-muted" />}
      {hasFilters && <span className="h-11 w-80 rounded-4xl bg-muted" />}
      <div className="flex flex-col gap-10 lg:flex-row lg:gap-8">
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
