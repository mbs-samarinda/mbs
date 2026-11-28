import { SCHOOLS, type SchoolKey } from "@mbs/school-config";
import { Badge } from "@mbs/ui/components/badge";
import { buttonVariants } from "@mbs/ui/components/button";
import {
  BookOpen,
  Check,
  Cpu,
  FlaskConical,
  GraduationCap,
  HeartHandshake,
  Mic,
  PenLine,
  ShieldCheck,
  Star,
  Store,
  Target,
  Tent,
  Users,
  Volleyball,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { type CycleFacts, formatFee, getCycleFacts, isOpen } from "@/admission.ts";
import { formatDate } from "@/articles.ts";
import { getArticles } from "@/cms/articles.ts";
import { type Media } from "@/cms/client.ts";
import { type ActivityIcon } from "@/cms/entries.ts";
import { type Block, type ValueIcon } from "@/cms/pages.ts";
import { type Site } from "@/cms/site.ts";
import { admissionUrl, articleHref, type Owner, ownerUrl } from "@/owners.ts";

import { ArticleMeta } from "./article-meta.tsx";
import { PendingSpinner } from "./pending-spinner.tsx";
import { Prose } from "./prose.tsx";
import {
  Arrival,
  Photo,
  PHOTO_SIZES,
  Placeholder,
  FactStrip,
  WIDTH,
  SECTION,
  Fact,
  SectionHeading,
  photoTransition,
} from "./section.tsx";

/**
 * The lists an editor types one per line into a `text` field.
 *
 * `\r?\n`, because text authored on Windows leaves a trailing carriage return
 * that `filter(Boolean)` does not catch — it renders as a blank bullet.
 */
const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** A card whose rows are separated by a rule rather than by a gap. */
const RowCard = ({ children }: { children: ReactNode }) => (
  <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
    {children}
  </div>
);

/**
 * One composed section, whichever kind an editor placed.
 *
 * The home page and `/profil` render every block through this, so a block moved
 * between them looks the same on both and a new kind is added once. `/kontak`
 * and `/pendaftaran` still draw their own — each is one block type arranged
 * around page-specific content — so a kind that belongs to one of them falls
 * through to `null` here rather than failing.
 *
 * `tinted` is passed by pages whose bands alternate down the page (`/profil`);
 * the older kinds carry a fixed band each, which is what the canvas draws for
 * the homepage.
 */
export function BlockSection({
  block,
  owner,
  schoolKey,
  site,
  tinted = false,
}: {
  block: Block;
  owner: Owner;
  schoolKey: SchoolKey | undefined;
  // The whole row rather than the fields the hero happens to need today: the
  // identity a block draws from keeps growing — CTA label, tagline, and now the
  // brand subline — and threading one more scalar through every caller each
  // time is churn for nothing.
  site: Site;
  tinted?: boolean;
}) {
  const band = tinted ? "bg-muted" : "";

  switch (block.kind) {
    case "hero":
      return (
        <Hero
          // `||`, not `??`: a heading an editor cleared comes back as an
          // empty string, and an empty `h1` leaves the page with no title.
          heading={block.heading || site.tagline}
          body={block.body}
          image={block.image}
          // The umbrella names itself above its promise, which is what the
          // frame draws. Derived from the identity already on the row rather
          // than typed into the block — a school wears a live cycle badge in
          // this slot instead, so neither is a second copy of a name.
          eyebrow={schoolKey ? null : `${owner.name} ${site.brandSubline ?? ""}`.trim()}
          secondaryLabel={block.secondaryLabel}
          secondaryHref={block.secondaryHref}
          schoolKey={schoolKey}
          admissionCta={site.admissionCta}
        />
      );

    case "image-text":
      return (
        <section className={`${SECTION} bg-muted`}>
          <div
            className={`${WIDTH} flex flex-col gap-8 md:flex-row md:items-center ${block.imageSide === "akhir" ? "md:flex-row-reverse" : ""}`}
          >
            <Photo
              sizes="(min-width: 768px) 288px, 100vw"
              image={block.image}
              label="Foto"
              className="aspect-4/3 w-full md:w-72"
            />
            <div className="flex flex-col gap-3">
              {block.heading && (
                <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                  {block.heading}
                </p>
              )}
              <Prose>{block.body}</Prose>
            </div>
          </div>
        </section>
      );

    // The apex's own section: a visitor landing there is choosing a school, so
    // this is the page's real navigation rather than a list of links.
    case "schools":
      return (
        // Named so an editor's `#sekolah` link can point here, with a scroll
        // margin because the header is sticky and two rows tall: without it the
        // heading lands behind the header.
        <section id="sekolah" className={`${SECTION} scroll-mt-28 bg-muted`}>
          <div className={`${WIDTH} flex flex-col gap-7`}>
            <SectionHeading head={block.head} />
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {block.items.map((item) => (
                // Keyed by the row id, not by the school: nothing stops an
                // editor adding two cards for one school, and the row id is the
                // only stable key — the rule the `faq` block already records.
                <SchoolCard key={item.id} card={item} />
              ))}
            </div>
          </div>
        </section>
      );

    case "rich-text":
      // Offered in the picker on every page slug, so a composed page that drew
      // nothing for it published a blank section with nothing to diagnose.
      return (
        <section className={`${SECTION} ${band}`}>
          <div className={WIDTH}>
            <Prose>{block.body}</Prose>
          </div>
        </section>
      );

    case "facts":
      return (
        <section className={`${SECTION} ${band}`}>
          <div className={`${WIDTH} flex flex-col gap-8 lg:flex-row lg:gap-16`}>
            <div className="flex flex-col gap-4 lg:flex-1">
              <h2 className="text-[28px] font-bold text-balance">{block.heading}</h2>
              {block.body && <Prose>{block.body}</Prose>}
            </div>
            {/* The card is the `dl` itself rather than `RowCard` around one:
                HTML allows a single `div` between a `dl` and its pairs, and a
                second level leaves every `dt`/`dd` without a valid parent — a
                screen reader then reads four loose strings instead of four
                labelled facts. */}
            <dl className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background lg:flex-1">
              {block.items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-5"
                >
                  <dt className="text-[13px] text-muted-foreground">{item.label}</dt>
                  <dd className="text-sm font-medium text-pretty sm:text-right">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      );

    case "timeline":
      return (
        <section className={`${SECTION} ${band}`}>
          <div className={`${WIDTH} flex flex-col gap-7`}>
            <SectionHeading head={block.head} />
            <RowCard>
              {block.items.map((item) => (
                <div key={item.id} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-6">
                  {/* Tabular figures so the years line up down the column. */}
                  <span className="font-bold text-primary tabular-nums">{item.year}</span>
                  <span className="text-[15px] text-pretty">{item.body}</span>
                </div>
              ))}
            </RowCard>
          </div>
        </section>
      );

    case "values":
      return (
        <section className={`${SECTION} ${band}`}>
          <div className={`${WIDTH} flex flex-col gap-7`}>
            <SectionHeading head={block.head} />
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {block.items.map((item) => {
                const Icon = VALUE_ICONS[item.icon];
                return (
                  <article
                    key={item.id}
                    className="flex flex-col gap-2.5 rounded-xl border border-border bg-background p-5"
                  >
                    {/* Stroke 1.75 beside a 700 title, per the icon rule. */}
                    <Icon className="size-5 text-primary" strokeWidth={1.75} aria-hidden />
                    <h3 className="text-[17px] font-bold text-pretty">{item.title}</h3>
                    {item.description && (
                      <p className="text-[13px] text-muted-foreground">{item.description}</p>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      );

    case "people":
      return (
        <section className={`${SECTION} ${band}`}>
          <div className={`${WIDTH} flex flex-col gap-7`}>
            <SectionHeading head={block.head} />
            {/* A portrait grid on a wide page and a 72px row on a phone: four
                portraits at phone width are stamp-sized, and a name beside a
                small photo is what the mobile frame draws. */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {block.items.map((person) => (
                <article
                  key={person.id}
                  className="flex items-center gap-4 rounded-xl border border-border bg-background p-3 md:flex-col md:items-stretch md:gap-0 md:p-0"
                >
                  <Photo
                    sizes="(min-width: 1024px) 300px, (min-width: 768px) 50vw, 72px"
                    image={person.photo}
                    label="Foto"
                    inCard
                    className="size-18 shrink-0 md:aspect-3/2 md:size-auto md:w-full md:rounded-b-none"
                  />
                  <div className="flex flex-col gap-1 md:p-4">
                    <h3 className="text-sm font-semibold text-pretty">{person.name}</h3>
                    <p className="text-[13px] text-muted-foreground">{person.role}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      );

    case "layers":
      return (
        <section className={`${SECTION} ${band}`}>
          <div className={`${WIDTH} flex flex-col gap-7`}>
            <SectionHeading head={block.head} />
            <RowCard>
              {block.items.map((item, index) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-1.5 px-5 py-4 md:flex-row md:items-baseline md:gap-5"
                >
                  {/* The layer number is the row's position, not a field: an
                      editor reordering the rows must not have to renumber them,
                      and cannot write "Lapis 7" on the second one. */}
                  <span className="text-xs font-bold tracking-wide text-primary uppercase tabular-nums">
                    Lapis {index + 1}
                  </span>
                  <span className="text-sm font-semibold text-pretty md:flex-1">{item.title}</span>
                  {item.description && (
                    <span className="text-[13px] text-muted-foreground md:flex-1">
                      {item.description}
                    </span>
                  )}
                </div>
              ))}
            </RowCard>
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
                      {lines(item.points).map((point) => (
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

    // Kurikulum, jenjang and keunggulan on `/program`: three facts with no
    // section heading above them, which is what the frame draws. The key takes
    // the owner's colour, the only place on this page that does.
    case "highlights":
      return (
        <section className={`${SECTION} ${band}`}>
          <div className={`${WIDTH} grid gap-5 md:grid-cols-3`}>
            {block.items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-background p-5"
              >
                <p className="text-xs font-bold tracking-wide text-primary uppercase">
                  {item.label}
                </p>
                <p className="text-[15px] leading-relaxed text-pretty">{item.value}</p>
              </div>
            ))}
          </div>
        </section>
      );

    // A jurusan carries more than a program does — a code, a duration and the
    // kompetensi under it — so it is its own block rather than a flag on
    // `programs`: an editor on the homepage is never shown fields that do
    // nothing there. Three columns on a desktop page, stacked below `lg`, which
    // is what the tablet and mobile frames draw.
    case "majors":
      return (
        <section className={`${SECTION} ${band}`}>
          <div className={`${WIDTH} flex flex-col gap-7`}>
            <SectionHeading head={block.head} />
            <div className="flex flex-col gap-4">
              {block.items.map((item) => (
                <article
                  key={item.id}
                  className="flex flex-col gap-6 rounded-xl border border-border bg-background p-6 lg:flex-row lg:gap-8"
                >
                  <div className="flex flex-col gap-2 lg:w-105">
                    {(item.code || item.meta) && (
                      <span className="flex items-center gap-2.5">
                        {/* Neutral, not a status pair. The frame tints this pill,
                            but a jurusan code is not a state — and the four
                            status colours are fixed and mean something else. */}
                        {item.code && <Badge variant="secondary">{item.code}</Badge>}
                        {item.meta && (
                          <span className="text-xs text-muted-foreground">{item.meta}</span>
                        )}
                      </span>
                    )}
                    <h3 className="text-xl leading-snug font-bold text-pretty">{item.title}</h3>
                  </div>

                  {item.description && (
                    <p className="flex-1 text-[15px] leading-relaxed text-pretty">
                      {item.description}
                    </p>
                  )}

                  {item.points && (
                    <div className="flex flex-col gap-2 lg:w-65">
                      <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                        Kompetensi inti
                      </p>
                      <ul className="flex flex-col gap-2">
                        {lines(item.points).map((point) => (
                          <li key={point} className="flex items-center gap-2 text-[13px]">
                            <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
                            {point}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      );

    case "facilities":
      return (
        <section className={`${SECTION} bg-muted`}>
          <div className={`${WIDTH} flex flex-col gap-7`}>
            <SectionHeading head={block.head} />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {block.items.map((item) => (
                <Link
                  key={item.slug}
                  href={`/fasilitas/${item.slug}`}
                  className="relative flex flex-col gap-3 rounded-xl border border-border bg-background p-3 hover:border-primary"
                >
                  {/* On the photo, which the card's padding insets by 12px. */}
                  <PendingSpinner className="top-5 right-5" />
                  <Photo
                    sizes={PHOTO_SIZES.third}
                    image={item.images[0] ?? null}
                    label="Foto"
                    className="aspect-3/2 w-full"
                    inCard
                    transition={photoTransition("/fasilitas", item.slug)}
                  />
                  <div className="flex flex-col gap-1 px-1 pb-1">
                    <h3 className="text-[17px] font-bold text-pretty">{item.title}</h3>
                    {item.summary && (
                      <p className="text-[13px] text-muted-foreground">{item.summary}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      );

    // An activity is a name and a glyph here, not a photograph: the canvas draws
    // six small tiles in one row, and the photo card beside it belongs to a
    // facility. A building is worth a picture and a description; a weekly
    // activity is a word a parent scans for, and its own page carries the rest.
    case "extracurriculars":
      return (
        <section className={SECTION}>
          <div className={`${WIDTH} flex flex-col gap-7`}>
            <SectionHeading head={block.head} />
            {/* One column below 20rem (200% zoom on a phone): two columns
                there are narrower than a word like "Kewirausahaan". */}
            <div className="grid grid-cols-2 gap-3 max-[20rem]:grid-cols-1 md:grid-cols-3 lg:grid-cols-6">
              {block.items.map((item) => {
                const Icon = ACTIVITY_ICONS[item.icon];
                return (
                  <Link
                    key={item.slug}
                    href={`/ekstrakurikuler/${item.slug}`}
                    className="relative flex flex-col gap-2.5 rounded-xl border border-border bg-background p-4 hover:border-primary"
                  >
                    <PendingSpinner />
                    {/* Stroke 1.75 beside a 500 label, per the icon rule. */}
                    <Icon className="size-5 text-primary" strokeWidth={1.75} aria-hidden />
                    <span className="text-sm font-medium text-pretty">{item.title}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      );

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
                    <Link
                      href={`/artikel/berita/${item.berita.slug}`}
                      className="text-[13px] font-semibold text-primary underline underline-offset-4"
                    >
                      Baca ceritanya
                    </Link>
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
            <Suspense
              fallback={
                <Placeholder>
                  <NewsPlaceholder count={block.limit} />
                </Placeholder>
              }
            >
              <Arrival>
                <NewsGrid ownerKey={owner.key} limit={block.limit} />
              </Arrival>
            </Suspense>
          </div>
        </section>
      );

    // The admission band is rendered by the page itself, not from the zone, so
    // an editor cannot delete the admission path by deleting a block. A block
    // placed here anyway is a duplicate of it. Kinds a page has no place for —
    // an FAQ outside `/pendaftaran`, a contact section outside `/kontak` — land
    // here too and render nothing.
    default:
      return null;
  }
}

/**
 * The six icons a value can carry.
 *
 * An enumeration rather than a free-text lucide name: a misspelled name renders
 * nothing at all, and a silent hole on a published page is not a failure an
 * editor would notice.
 */
const VALUE_ICONS: Record<ValueIcon, LucideIcon> = {
  kitab: BookOpen,
  perisai: ShieldCheck,
  kunci: Wrench,
  tangan: HeartHandshake,
  orang: Users,
  "topi-wisuda": GraduationCap,
};

/**
 * The glyphs an activity can wear on the homepage's tiles.
 *
 * A second list rather than a reuse of the one above: a value is an idea and an
 * activity is a thing that happens, and nothing a school runs is drawn by a
 * shield. `bintang` is the fallback for an activity none of the others fit —
 * the tile is icon and name only, so a missing glyph leaves half of it empty.
 */
const ACTIVITY_ICONS: Record<ActivityIcon, LucideIcon> = {
  kitab: BookOpen,
  tenda: Tent,
  bola: Volleyball,
  target: Target,
  komputer: Cpu,
  pena: PenLine,
  labu: FlaskConical,
  mikrofon: Mic,
  toko: Store,
  bintang: Star,
};

// Holds the row's height while the listing streams in.
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
    return <p className="text-sm text-muted-foreground">Belum ada artikel.</p>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {articles.map((article) => (
        <Link
          // Slugs are unique per owner only, and one list now holds several.
          key={`${article.type}-${article.ownerKey}-${article.slug}`}
          href={articleHref(article, ownerKey)}
          className="relative flex flex-col gap-3 rounded-xl border border-border bg-background p-3 hover:border-primary"
        >
          {/* On the photo, which the card's padding insets by 12px. */}
          <PendingSpinner className="top-5 right-5" />
          <Photo
            sizes={PHOTO_SIZES.third}
            image={article.cover}
            label="Sampul"
            className="aspect-3/2 w-full"
            inCard
            transition={
              // Another owner's article opens on its own host, with a full page load.
              article.ownerKey === ownerKey
                ? photoTransition(article.ownerKey, article.type, article.slug)
                : undefined
            }
          />
          <div className="flex flex-col gap-1.5 px-1 pb-1">
            <ArticleMeta article={article} site={ownerKey} />
            <h3 className="text-[17px] font-bold text-pretty">{article.title}</h3>
            {article.summary && (
              <p className="text-[13px] text-muted-foreground">{article.summary}</p>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

/**
 * One school, on the umbrella's home page.
 *
 * The name and the address come from `packages/school-config` and `ownerUrl`,
 * never from the editor: the schools sit on different hosts, so a URL typed at
 * the apex is the one link shape that cannot be relative and a field for it
 * would send every local and staging visitor to production. The editor supplies
 * the photograph, the jenjang line and the description.
 *
 * The status is live and streams in beside the rest, the same as the hero's:
 * the apex takes no applications of its own, but it does say which school is
 * open. A cycle that cannot be read shows nothing rather than a guess.
 */
function SchoolCard({ card }: { card: Extract<Block, { kind: "schools" }>["items"][number] }) {
  const school = SCHOOLS.find((candidate) => candidate.key === card.school);
  // The CMS enumeration is the same three keys, so this is unreachable — and it
  // returns nothing rather than guessing a school, which is the failure the
  // owner boundary exists to stop.
  if (!school) return null;

  return (
    <a
      href={ownerUrl(school)}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-background transition-colors duration-150 ease-[ease] hover:border-primary"
    >
      <Photo
        sizes={PHOTO_SIZES.third}
        image={card.photo}
        label="Foto"
        className="aspect-43/20 w-full rounded-none!"
        inCard
      />
      <div className="flex flex-col gap-2.5 p-5">
        <span className="flex flex-wrap items-center gap-2.5">
          {/* Sized for "Dibuka", not for the hero's full sentence: a
              placeholder wider than the badge it becomes pushes the jenjang
              line onto a second row and reflows when the status arrives. */}
          <Suspense fallback={<span className="h-6 w-16 rounded-4xl bg-muted" />}>
            <SchoolStatus schoolKey={school.key} />
          </Suspense>
          <span className="text-xs text-muted-foreground">
            {school.level}
            {card.meta && ` · ${card.meta}`}
          </span>
        </span>
        <h3 className="text-[19px] leading-snug font-bold text-pretty">{school.name}</h3>
        {card.description && (
          <p className="text-[13px] text-muted-foreground">{card.description}</p>
        )}
        {/* Its own 44px row: on a phone this is the thing being tapped, and the
            card around it is taller than a thumb can aim at. */}
        <span className="flex min-h-11 items-center text-[13px] font-bold text-primary underline underline-offset-4">
          Buka situs sekolah
        </span>
      </div>
    </a>
  );
}

async function SchoolStatus({ schoolKey }: { schoolKey: SchoolKey }) {
  const facts = await getCycleFacts(schoolKey);
  if (facts.state !== "cycle") return null;
  return <SchoolStatusBadge facts={facts} className="h-6 px-2.5" />;
}

/**
 * Whether one school's admission is open, in a word — on a surface that lists
 * the schools: the umbrella's table and the home page's school cards.
 *
 * Success rather than the owner's colour, which is what those frames draw
 * (`bh1UE`, `sjqBc`) and what the brand guide requires: an open admission is a
 * workflow state, and a school colour never recolors one. The hero's own badge
 * is deliberately not this component — its frame carries no success fill, and it
 * announces the cycle rather than comparing schools.
 *
 * The three states the band and the card already have apply here too, so a cycle
 * we could not read says exactly that instead of reading as closed.
 *
 * Status never rides on colour alone either: the badge carries the word, so
 * "Ditutup" reads the same to someone who cannot tell the two fills apart.
 */
function SchoolStatusBadge({ facts, className }: { facts: CycleFacts | null; className?: string }) {
  if (facts === null)
    return <span className={`block h-5 w-20 rounded-4xl bg-muted ${className ?? ""}`} />;
  if (facts.state === "unavailable")
    return (
      <Badge variant="outline" className={className}>
        Belum bisa dibaca
      </Badge>
    );
  if (facts.state === "none")
    return (
      <Badge variant="secondary" className={className}>
        Belum dibuka
      </Badge>
    );

  const open = isOpen(facts.cycle);
  return (
    <Badge variant={open ? "success" : "secondary"} className={className}>
      {open ? "Dibuka" : "Ditutup"}
    </Badge>
  );
}

function Hero({
  heading,
  body,
  image,
  eyebrow,
  secondaryLabel,
  secondaryHref,
  schoolKey,
  admissionCta,
}: {
  heading: string;
  body: string | null;
  image: Media | null;
  eyebrow: string | null;
  secondaryLabel: string | null;
  secondaryHref: string | null;
  schoolKey: SchoolKey | undefined;
  admissionCta: string;
}) {
  return (
    <section className={SECTION}>
      {/* Photo above the text until xl: narrower, a half-width column breaks the
          44px heading into four or five lines. */}
      <div
        className={`${WIDTH} flex flex-col-reverse gap-10 xl:flex-row xl:items-center xl:gap-16`}
      >
        <div className="flex flex-col gap-5 xl:flex-1">
          {eyebrow && (
            <p className="text-[13px] font-bold tracking-wide text-primary uppercase">{eyebrow}</p>
          )}
          {schoolKey && (
            <Suspense
              fallback={
                <Placeholder>
                  <StatusPlaceholder />
                </Placeholder>
              }
            >
              <Arrival>
                <CycleStatus schoolKey={schoolKey} />
              </Arrival>
            </Suspense>
          )}
          <h1 className="text-[32px] leading-tight font-extrabold text-balance md:text-[44px]">
            {heading}
          </h1>
          {body && (
            <p className="max-w-[65ch] text-base text-pretty text-muted-foreground">{body}</p>
          )}
          <div className="flex flex-wrap gap-3">
            <Link
              href={schoolKey ? "/pendaftaran" : admissionUrl()}
              className={buttonVariants({ size: "touch" })}
            >
              {admissionCta}
            </Link>
            {/* Both halves or neither: a label with no address is a button that
                goes nowhere, and an address with no label is invisible. */}
            {secondaryLabel && secondaryHref && (
              <Link
                href={secondaryHref}
                className={buttonVariants({ variant: "outline", size: "touch" })}
              >
                {secondaryLabel}
              </Link>
            )}
          </div>
          {schoolKey && (
            <Suspense
              fallback={
                <Placeholder>
                  <FactsPlaceholder count={3} />
                </Placeholder>
              }
            >
              <Arrival>
                <HeroFacts schoolKey={schoolKey} />
              </Arrival>
            </Suspense>
          )}
        </div>
        {/* min-w-0: an image's width attribute is otherwise its flex minimum,
            and it takes the text column's share. */}
        <Photo
          sizes="(min-width: 1440px) 570px, (min-width: 1280px) 50vw, 100vw"
          image={image}
          label="Foto sekolah"
          className="aspect-video xl:aspect-4/3 xl:min-w-0 xl:flex-1"
        />
      </div>
    </section>
  );
}

// A skeleton that holds the row's height.
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
      <Fact label="Biaya pendaftaran">{formatFee(facts.cycle.effectiveFee)}</Fact>
      <Fact label="Hasil diumumkan">{formatDate(facts.cycle.resultPublishAt)}</Fact>
    </FactStrip>
  );
}
