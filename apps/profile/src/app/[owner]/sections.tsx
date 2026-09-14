import type { SchoolKey } from "@mbs/school-config";
import { Badge } from "@mbs/ui/components/badge";
import { buttonVariants } from "@mbs/ui/components/button";
import { cn } from "cn";
import {
  BookOpen,
  GraduationCap,
  HeartHandshake,
  ShieldCheck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import { Suspense, type ReactNode } from "react";

import { getCycleFacts, isOpen, type CycleFacts } from "../../admission.ts";
import { getArticles, mediaUrl, type Block, type Media, type ValueIcon } from "../../cms.ts";
import type { Owner } from "../../owners.ts";
import { Prose } from "./prose.tsx";

/**
 * The pieces every composed page is built from.
 *
 * They sit beside the pages rather than inside one: the admission band, the
 * fact strip and the photo slot are each drawn once on the canvas and appear on
 * several routes, and the band in particular is the same component on the home
 * page and on `/pendaftaran`.
 */

/** Section rhythm: 48px at tablet, 120px on a desktop page, per the canvas. */
export const SECTION = "px-4 py-12 md:px-12 md:py-12 lg:px-30 lg:py-15";
export const WIDTH = "mx-auto w-full max-w-300";

const DATE = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  // Pinned, not left to the server's clock. A close time of 17.00 UTC is the
  // 31st on a UTC host and the 1st in Samarinda, and a wrong admission date is
  // the failure this whole product is built against.
  timeZone: "Asia/Makassar",
});

/** Short form, for fact strips and tables. Prose and headlines spell the month. */
export const formatDate = (iso: string) => DATE.format(new Date(iso));

const LONG_DATE = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Makassar",
});

/** Spelled out, for prose and for an article's byline. One format per context. */
export const formatLongDate = (iso: string) => LONG_DATE.format(new Date(iso));

/** Whole rupiah. The API carries no fractional fee and none is ever displayed. */
export const formatFee = (amount: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);

/** The title and standfirst a content page opens with. */
export const PageHead = ({ heading, body }: { heading: string; body: string }) => (
  <section className={`${SECTION} pb-0 md:pb-0 lg:pb-0`}>
    <div className={`${WIDTH} flex flex-col gap-3`}>
      <h1 className="text-[32px] leading-tight font-extrabold text-balance md:text-[44px]">
        {heading}
      </h1>
      <p className="max-w-[65ch] text-base text-pretty text-muted-foreground">{body}</p>
    </div>
  </section>
);

export function SectionHeading({
  head,
}: {
  head: {
    heading: string;
    description: string | null;
    linkLabel: string | null;
    linkHref: string | null;
  };
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[28px] font-bold text-balance">{head.heading}</h2>
        {head.description && (
          <p className="max-w-[65ch] text-base text-pretty text-muted-foreground">
            {head.description}
          </p>
        )}
      </div>
      {head.linkLabel && head.linkHref && (
        <a
          href={head.linkHref}
          className="flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary underline underline-offset-4"
        >
          {head.linkLabel}
        </a>
      )}
    </div>
  );
}

/**
 * A photograph, or the labelled slot standing in for one.
 *
 * No photography has been supplied for any owner, so the slot is the normal
 * state today rather than an error. The outline is what keeps a photo from
 * dissolving into the page — white photos into a white page, dark ones into a
 * dark page — so it flips with the mode and is dropped only inside a bordered
 * card, where the card's own border already draws that edge.
 */
export function Photo({
  image,
  label,
  className,
  inCard = false,
}: {
  image: Media | null;
  label: string;
  className: string;
  inCard?: boolean;
}) {
  const edge = inCard ? "" : "outline outline-black/10 dark:outline-white/12";

  if (!image) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg bg-muted text-[11px] font-semibold tracking-wide text-muted-foreground uppercase ${edge} ${className}`}
      >
        {label}
      </div>
    );
  }

  return (
    <Image
      src={mediaUrl(image)}
      alt={image.alternativeText ?? ""}
      width={image.width}
      height={image.height}
      className={`rounded-lg object-cover ${edge} ${className}`}
    />
  );
}

export const FactStrip = ({ children }: { children: ReactNode }) => (
  <dl className="flex flex-wrap gap-x-8 gap-y-3">{children}</dl>
);

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      {/* Tabular figures on every date, fee and count: proportional digits make
          a row of facts ragged and a changing value jump. */}
      <dd className="text-sm font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * The admission invitation, reading live cycle facts.
 *
 * `facts` is `null` while the request is in flight: the rest of the page is
 * prerendered and this band streams in, so the shell ships with the heading and
 * a placeholder that holds its height.
 *
 * There is no stale-date path. When the call fails the band says so and offers
 * the ways through that do not depend on it — the admission page and the
 * committee's own contact — because a wrong date here is the exact failure this
 * product exists to stop.
 */
export function AdmissionBand({
  facts,
  admissionCta,
}: {
  facts: CycleFacts | null;
  admissionCta: string;
}) {
  const cycle = facts?.state === "cycle" ? facts.cycle : null;
  const open = cycle ? isOpen(cycle) : false;

  const heading = !cycle
    ? "Pendaftaran santri baru"
    : open
      ? `Pendaftaran ${cycle.name} sedang dibuka`
      : `Pendaftaran ${cycle.name} sudah ditutup`;

  const body =
    facts?.state === "unavailable"
      ? "Status, tanggal, dan biaya dibaca dari sistem pendaftaran dan sedang tidak dapat dihubungi. Kami tidak menampilkan tanggal lama."
      : "Isi data anak, unggah dokumen, dan bayar dari satu akun. Bisa dilanjutkan kapan saja.";

  return (
    <section className={`${SECTION} bg-primary text-primary-foreground`}>
      <div className={`${WIDTH} flex flex-col gap-7`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 lg:max-w-[65ch]">
            <h2 className="text-2xl font-bold text-balance md:text-3xl">{heading}</h2>
            <p className="text-sm text-pretty opacity-90">{body}</p>
          </div>
          <a
            href="/pendaftaran"
            // `cn` and not a template string: the default variant already sets
            // `bg-primary`, and two background utilities in one attribute are
            // resolved by stylesheet order rather than by the order written
            // here. Merging drops the loser, so the override actually lands.
            //
            // Paper surface with the owner's colour as the label, which is the
            // one pairing that holds in both modes: on a light page the button
            // is white with teal text, and in dark mode the band's primary is
            // light while `background` is near-black, so it inverts with it.
            className={cn(
              buttonVariants({ size: "touch" }),
              "shrink-0 bg-background text-primary hover:bg-muted",
            )}
          >
            {admissionCta}
          </a>
        </div>

        {facts === null && <BandFactsPlaceholder />}

        {cycle && (
          <dl className="flex flex-wrap gap-x-10 gap-y-4 border-t border-primary-foreground/20 pt-6">
            <BandFact label="Status">{open ? "Dibuka" : "Ditutup"}</BandFact>
            <BandFact label="Dibuka">{formatDate(cycle.registrationOpenAt)}</BandFact>
            <BandFact label="Ditutup">{formatDate(cycle.registrationCloseAt)}</BandFact>
            <BandFact label="Biaya sekolah">{formatFee(cycle.effectiveFee)}</BandFact>
            <BandFact label="Hasil diumumkan">{formatDate(cycle.resultPublishAt)}</BandFact>
          </dl>
        )}

        {facts?.state === "unavailable" && (
          <p className="border-t border-primary-foreground/20 pt-6 text-sm opacity-90">
            Perlu jawaban sekarang? Hubungi panitia lewat kontak di bawah halaman ini.
          </p>
        )}

        {cycle && (
          <p className="text-xs opacity-90">
            Tanggal, biaya, dan status dibaca langsung dari sistem pendaftaran.
          </p>
        )}
      </div>
    </section>
  );
}

// The band's label copy is deliberately solid rather than faded: at 90% on a
// filled brand band it still clears 5:1, which a lighter opacity would not.
const BandFact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-xs opacity-90">{label}</dt>
    <dd className="text-[15px] font-semibold tabular-nums">{children}</dd>
  </div>
);

/**
 * The band, with the live facts streamed in behind it.
 *
 * The umbrella takes no applications of its own, so its band carries no cycle
 * and sends a visitor to the joint campaign page instead.
 */
export function AdmissionBandSection({
  schoolKey,
  admissionCta,
}: {
  schoolKey: SchoolKey | undefined;
  admissionCta: string;
}) {
  if (!schoolKey) {
    return <AdmissionBand facts={{ state: "none" }} admissionCta={admissionCta} />;
  }

  return (
    <Suspense fallback={<AdmissionBand facts={null} admissionCta={admissionCta} />}>
      <LiveAdmissionBand schoolKey={schoolKey} admissionCta={admissionCta} />
    </Suspense>
  );
}

async function LiveAdmissionBand({
  schoolKey,
  admissionCta,
}: {
  schoolKey: SchoolKey;
  admissionCta: string;
}) {
  const facts: CycleFacts = await getCycleFacts(schoolKey);
  return <AdmissionBand facts={facts} admissionCta={admissionCta} />;
}

/**
 * The admission path as a sidebar card, for the pages that carry no band.
 *
 * `/berita` and its articles invite a visitor sideways rather than closing with
 * a call to action, so the live cycle appears beside the content instead of
 * under it. Same three states as the band, and for the same reason: a cycle we
 * could not read is not a closed cycle, so the card still names the way in
 * rather than disappearing.
 */
export function AdmissionCardSection({ schoolKey }: { schoolKey: SchoolKey | undefined }) {
  if (!schoolKey) {
    return <AdmissionCard facts={{ state: "none" }} />;
  }

  return (
    <Suspense fallback={<AdmissionCard facts={null} />}>
      <LiveAdmissionCard schoolKey={schoolKey} />
    </Suspense>
  );
}

async function LiveAdmissionCard({ schoolKey }: { schoolKey: SchoolKey }) {
  return <AdmissionCard facts={await getCycleFacts(schoolKey)} />;
}

function AdmissionCard({ facts }: { facts: CycleFacts | null }) {
  const cycle = facts?.state === "cycle" ? facts.cycle : null;
  const open = cycle ? isOpen(cycle) : false;

  const heading = !cycle
    ? "Pendaftaran santri baru"
    : open
      ? `Pendaftaran ${cycle.name} dibuka`
      : `Pendaftaran ${cycle.name} ditutup`;

  const body =
    facts?.state === "unavailable"
      ? "Status dan tanggal sedang tidak dapat dibaca dari sistem pendaftaran."
      : cycle
        ? `${open ? "Ditutup" : "Dibuka"} ${formatDate(open ? cycle.registrationCloseAt : cycle.registrationOpenAt)}. Dibaca langsung dari sistem pendaftaran.`
        : "Syarat, jadwal, dan biaya ada di halaman pendaftaran.";

  return (
    <aside className="flex flex-col gap-2 rounded-xl bg-info-tint p-5">
      {/* The heading holds its height while the facts stream in, so the sidebar
          does not jump under a visitor who is already reading. */}
      <h2 className="text-base font-bold text-pretty">
        {facts === null ? <span className="block h-5 w-48 rounded-md bg-info/15" /> : heading}
      </h2>
      {/* Ink rather than muted: supporting grey measures 4.41:1 on this tint,
          under the floor. The tint is the one ground in the system where that
          pairing fails. */}
      <p className="text-[13px] text-pretty tabular-nums">
        {facts === null ? <span className="block h-9 w-full rounded-md bg-info/10" /> : body}
      </p>
      <a
        href="/pendaftaran"
        className="flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4"
      >
        Buka halaman pendaftaran
      </a>
    </aside>
  );
}

const BandFactsPlaceholder = () => (
  <div className="flex flex-wrap gap-x-10 gap-y-4 border-t border-primary-foreground/20 pt-6">
    {Array.from({ length: 5 }, (_, index) => (
      <span key={index} className="h-8 w-28 rounded-md bg-primary-foreground/15" />
    ))}
  </div>
);

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
  admissionCta,
  tinted = false,
}: {
  block: Block;
  owner: Owner;
  schoolKey: SchoolKey | undefined;
  admissionCta: string;
  tinted?: boolean;
}) {
  const band = tinted ? "bg-muted" : "";

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
              <Prose>{block.body}</Prose>
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
