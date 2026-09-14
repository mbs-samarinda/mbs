import type { SchoolKey } from "@mbs/school-config";
import { buttonVariants } from "@mbs/ui/components/button";
import { cn } from "cn";
import Image from "next/image";
import { Suspense, type ReactNode } from "react";

import { getCycleFacts, isOpen, type CycleFacts } from "../../admission.ts";
import { mediaUrl, type Media } from "../../cms.ts";

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

const BandFactsPlaceholder = () => (
  <div className="flex flex-wrap gap-x-10 gap-y-4 border-t border-primary-foreground/20 pt-6">
    {Array.from({ length: 5 }, (_, index) => (
      <span key={index} className="h-8 w-28 rounded-md bg-primary-foreground/15" />
    ))}
  </div>
);
