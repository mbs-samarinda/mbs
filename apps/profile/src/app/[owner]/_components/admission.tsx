import { type SchoolKey } from "@mbs/school-config";
import { buttonVariants } from "@mbs/ui/components/button";
import { cn } from "cn";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { type CycleFacts, formatFee, getCycleFacts, isOpen } from "@/admission.ts";
import { formatDate } from "@/articles.ts";

import { WIDTH, SECTION } from "./section.tsx";

/**
 * The admission invitation, reading live cycle facts.
 *
 * `facts` is `null` while the request is in flight: the rest of the page
 * renders first and this band streams in, so the shell ships with the heading and
 * a placeholder that holds its height.
 *
 * There is no stale-date path. When the call fails the band says so and offers
 * the ways through that do not depend on it — the admission page and the
 * committee's own contact — because a wrong date here is the exact failure this
 * product exists to stop.
 */
function AdmissionBand({
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
          <Link
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
          </Link>
        </div>

        {facts === null && <BandFactsPlaceholder />}

        {cycle && (
          <dl className="flex flex-wrap gap-x-10 gap-y-4 border-t border-primary-foreground/20 pt-6">
            <BandFact label="Status">{open ? "Dibuka" : "Ditutup"}</BandFact>
            <BandFact label="Dibuka">{formatDate(cycle.registrationOpenAt)}</BandFact>
            <BandFact label="Ditutup">{formatDate(cycle.registrationCloseAt)}</BandFact>
            <BandFact label="Biaya pendaftaran">{formatFee(cycle.effectiveFee)}</BandFact>
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
 * School pages only: the apex takes no applications and carries no band.
 */
export function AdmissionBandSection({
  schoolKey,
  admissionCta,
}: {
  schoolKey: SchoolKey;
  admissionCta: string;
}) {
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
 * `/artikel` and its articles invite a visitor sideways rather than closing with
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
      <Link
        href="/pendaftaran"
        className="flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4"
      >
        Buka halaman pendaftaran
      </Link>
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
