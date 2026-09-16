import { SCHOOLS, type School, type SchoolKey } from "@mbs/school-config";
import { Badge } from "@mbs/ui/components/badge";
import { buttonVariants } from "@mbs/ui/components/button";
import { cn } from "cn";
import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  anySchoolOpen,
  getCycleFacts,
  isOpen,
  splitDocuments,
  type CycleFacts,
} from "../../../admission.ts";
import { getPage, getSite, type Block, type Site } from "../../../cms.ts";
import { OWNERS, admissionUrl } from "../../../owners.ts";
import {
  Fact,
  FactStrip,
  PageHead,
  SECTION,
  SectionHeading,
  WIDTH,
  formatDate,
  formatFee,
} from "../sections.tsx";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) return {};

  const page = await getPage(owner.key, "pendaftaran");
  return {
    title: page?.seo?.metaTitle ?? "Pendaftaran",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

/**
 * The admission page, for a school and for the umbrella.
 *
 * Both read the same live cycle facts; they differ in how many. A school asks
 * about itself, the umbrella asks about all three — one shared cycle row per
 * intake, so the three answers cannot disagree about dates, only about fee and
 * whether that school joined.
 *
 * The page never renders a date it did not just read. Editors own the words
 * around the facts — the FAQ and any extra text block — and nothing else here.
 */
export default async function AdmissionPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) notFound();

  const [site, page] = await Promise.all([getSite(owner.key), getPage(owner.key, "pendaftaran")]);
  const school = SCHOOLS.find((candidate) => candidate.key === owner.key);
  const blocks = page?.blocks ?? [];

  return (
    <main>
      {school ? (
        <SchoolAdmission school={school} site={site} blocks={blocks} />
      ) : (
        <UmbrellaAdmission site={site} blocks={blocks} />
      )}
    </main>
  );
}

function SchoolAdmission({
  school,
  site,
  blocks,
}: {
  school: School;
  site: Site;
  blocks: readonly Block[];
}) {
  return (
    <>
      <PageHead
        heading="Pendaftaran santri baru"
        body="Tanggal, biaya, dan syarat di halaman ini dibaca langsung dari sistem pendaftaran."
      />
      {/* Two boundaries rather than one around the whole page: the steps between
          them are fixed copy and ship with the prerendered HTML. `getCycleFacts`
          is memoised per render, so this is still one request. */}
      <Suspense fallback={<StatusPanel facts={null} admissionCta={site.admissionCta} />}>
        <LiveStatus schoolKey={school.key} admissionCta={site.admissionCta} />
      </Suspense>
      <Steps
        steps={SCHOOL_STEPS}
        heading="Alur pendaftaran"
        description="Lima langkah. Data yang sudah diisi tidak hilang bila berhenti di tengah jalan."
      />
      <Suspense fallback={<DocumentsSection facts={null} />}>
        <Documents schoolKey={school.key} />
      </Suspense>
      <EditorBlocks blocks={blocks} />
      <Contacts site={site} />
    </>
  );
}

function UmbrellaAdmission({ site, blocks }: { site: Site; blocks: readonly Block[] }) {
  return (
    <>
      <PageHead
        heading="Pendaftaran bersama"
        body="Satu siklus, tiga sekolah. Semua angka di halaman ini dibaca dari sistem pendaftaran."
      />
      <Suspense fallback={<UmbrellaStatus facts={null} admissionCta={site.admissionCta} />}>
        <LiveUmbrellaStatus admissionCta={site.admissionCta} />
      </Suspense>
      <Steps
        steps={UMBRELLA_STEPS}
        heading="Cara mendaftar"
        description="Sama untuk ketiga sekolah. Sekolah dipilih di langkah pertama."
      />
      <EditorBlocks blocks={blocks} />
    </>
  );
}

async function LiveStatus({
  schoolKey,
  admissionCta,
}: {
  schoolKey: SchoolKey;
  admissionCta: string;
}) {
  const facts = await getCycleFacts(schoolKey);
  return <StatusPanel facts={facts} admissionCta={admissionCta} />;
}

/**
 * The state of registration, and the two ways through it.
 *
 * Closing a cycle disables starting and keeps continuing: an application that
 * already exists is still being worked on by its family and verified by the
 * committee. `facts` is null while the request is in flight.
 */
function StatusPanel({ facts, admissionCta }: { facts: CycleFacts | null; admissionCta: string }) {
  const cycle = facts?.state === "cycle" ? facts.cycle : null;
  const open = cycle ? isOpen(cycle) : false;

  const heading = !cycle
    ? "Status pendaftaran"
    : open
      ? `Pendaftaran ${cycle.name} sedang dibuka`
      : `Pendaftaran ${cycle.name} sudah ditutup`;

  const body =
    facts?.state === "unavailable"
      ? "Status, tanggal, dan biaya dibaca dari sistem pendaftaran dan sedang tidak dapat dihubungi. Kami tidak menampilkan tanggal lama."
      : // No cycle at all is its own sentence, not the loading copy: inviting a
        // family to continue an application this school is not taking is worse
        // than saying nothing yet.
        facts?.state === "none"
        ? "Jadwal pendaftaran berikutnya diumumkan di halaman ini."
        : cycle && !open
          ? "Aplikasi yang sudah dibuat tetap bisa dilanjutkan sampai panitia menyelesaikan verifikasi."
          : "Pendaftaran bisa dilanjutkan kapan saja dari akun yang sama.";

  return (
    <section className={SECTION}>
      <div className={`${WIDTH} flex flex-col gap-6 rounded-xl border border-border p-6 md:p-8`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col items-start gap-2 lg:max-w-[65ch]">
            {cycle && (
              <Badge variant={open ? "default" : "secondary"} className="h-6 px-2.5">
                {open ? "Dibuka" : "Ditutup"}
              </Badge>
            )}
            <h2 className="text-2xl font-bold text-balance">{heading}</h2>
            <p className="text-sm text-pretty text-muted-foreground">{body}</p>
          </div>
          <Actions
            state={
              facts === null
                ? "loading"
                : facts.state === "unavailable"
                  ? "unknown"
                  : open
                    ? "open"
                    : "closed"
            }
            admissionCta={admissionCta}
          />
        </div>

        {facts === null && <FactsPlaceholder count={4} />}

        {cycle && (
          <FactStrip>
            <Fact label="Dibuka">{formatDate(cycle.registrationOpenAt)}</Fact>
            <Fact label="Ditutup">{formatDate(cycle.registrationCloseAt)}</Fact>
            <Fact label="Biaya sekolah">{formatFee(cycle.effectiveFee)}</Fact>
            <Fact label="Hasil diumumkan">{formatDate(cycle.resultPublishAt)}</Fact>
          </FactStrip>
        )}
      </div>
    </section>
  );
}

/**
 * Start and continue, in that order.
 *
 * Four states, and the difference between two of them is the point. `closed` is
 * the committee having shut registration, and it draws a disabled control —
 * visible, not hidden, so a family arriving late sees the path existed. `unknown`
 * is us failing to read the cycle, and it draws the live link: the admission app
 * knows its own state, and greying the way in because our own request failed
 * would turn our outage into a closed door. `loading` claims nothing at all.
 */
type ActionState = "loading" | "open" | "closed" | "unknown";

function Actions({ state, admissionCta }: { state: ActionState; admissionCta: string }) {
  return (
    // `shrink-0` because both callers put this beside a `lg:max-w-[65ch]` copy
    // column in a `lg:flex-row` row. Without it the row squeezes this box below
    // its content width and `flex-wrap` does as it is told, stacking the two
    // buttons on a 1440 page where the canvas draws them side by side (`bh1UE`,
    // node `z8aqK`, 348x44). Below `lg` the parent is a column, this is full
    // width, and the wrap is what stacks them on a phone — which is why the
    // wrap stays.
    <div className="flex shrink-0 flex-wrap gap-3">
      {state === "loading" ? (
        // The prerendered shell. It holds the row's height and says nothing: a
        // slow admission system must not bake a greyed-out button into the HTML.
        <span aria-hidden className="h-11 w-44 rounded-xl bg-muted" />
      ) : state === "open" || state === "unknown" ? (
        <a href={admissionUrl()} className={buttonVariants({ size: "touch" })}>
          {admissionCta}
        </a>
      ) : (
        // `aria-disabled`, not `disabled`: a disabled button leaves the tab
        // order, so a keyboard visitor arriving after the cycle shut would never
        // learn the path existed. This one is reachable and announced as
        // unavailable; it has no handler, so reaching it does nothing.
        <button
          type="button"
          aria-disabled="true"
          className={cn(buttonVariants({ size: "touch" }), "opacity-50")}
        >
          {admissionCta}
        </button>
      )}
      {/* Both land on the admission app's root, which is where a returning
          family signs in and finds the draft it left. It has no separate
          continue route to link at, and inventing one here would be a link to
          a page that does not exist. */}
      <a href={admissionUrl()} className={buttonVariants({ variant: "outline", size: "touch" })}>
        Lanjutkan aplikasi
      </a>
    </div>
  );
}

const FactsPlaceholder = ({ count }: { count: number }) => (
  <div className="flex flex-wrap gap-x-8 gap-y-3">
    {Array.from({ length: count }, (_, index) => (
      <span key={index} className="h-8 w-28 rounded-md bg-muted" />
    ))}
  </div>
);

async function Documents({ schoolKey }: { schoolKey: SchoolKey }) {
  const facts = await getCycleFacts(schoolKey);
  return <DocumentsSection facts={facts} />;
}

/**
 * What a family has to bring, and what it costs.
 *
 * An unreachable admission system says so here rather than dropping the section:
 * a page that simply stops listing documents reads as a school that asks for
 * none. A cycle with no requirements set yet is the same sentence — the
 * committee has not published a list, which is not the same as "no documents".
 */
function DocumentsSection({ facts }: { facts: CycleFacts | null }) {
  // No cycle, nothing to require: this section would otherwise announce that the
  // committee has set no documents "for this cycle", above a panel that just
  // said there is no cycle.
  if (facts?.state === "none") return null;

  const cycle = facts?.state === "cycle" ? facts.cycle : null;
  const { required, optional } = splitDocuments(cycle?.documents ?? []);

  const note =
    facts === null
      ? null
      : facts.state === "unavailable"
        ? "Daftar dokumen dibaca dari sistem pendaftaran dan sedang tidak dapat dihubungi. Hubungi panitia untuk memastikan sebelum menyiapkan berkas."
        : required.length === 0 && optional.length === 0
          ? "Panitia belum menetapkan daftar dokumen untuk siklus ini."
          : null;

  return (
    <section className={`${SECTION} bg-muted`}>
      <div className={`${WIDTH} flex flex-col gap-7`}>
        <SectionHeading
          head={{
            heading: "Dokumen dan biaya",
            description: "Daftar dokumen mengikuti ketetapan panitia pada siklus berjalan.",
            linkLabel: null,
            linkHref: null,
          }}
        />
        {facts === null && <FactsPlaceholder count={3} />}
        {note && <p className="max-w-[65ch] text-sm text-pretty text-muted-foreground">{note}</p>}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <DocumentList heading="Wajib diunggah" items={required} />
          <DocumentList heading="Opsional" items={optional} />
          <div className="flex flex-col gap-4">
            {cycle && (
              <FactStrip>
                <Fact label="Biaya sekolah">{formatFee(cycle.effectiveFee)}</Fact>
              </FactStrip>
            )}
            <p className="max-w-[65ch] text-[13px] text-pretty text-muted-foreground">
              Pembayaran yang berhasil bukan berarti aplikasi sudah terkirim. Pengiriman dilakukan
              terpisah oleh orang tua/wali.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function DocumentList({ heading, items }: { heading: string; items: readonly string[] }) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{heading}</h3>
      <ul className="flex flex-col gap-1.5 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The five steps of an application.
 *
 * Hard-coded rather than editor content: they describe what the admission
 * application does, so a CMS copy of them would drift from the product the
 * moment a step changes, and no editor would know it had.
 */
const SCHOOL_STEPS = [
  ["Isi data anak", "Pilih sekolah dan isi data dasar calon santri."],
  ["Masuk akun", "Masuk dengan Google atau kode dari email."],
  ["Lengkapi berkas", "Unggah dokumen wajib dari galeri atau kamera."],
  ["Bayar", "Bayar lewat Midtrans; status dibaca dari sistem."],
  ["Kirim", "Kirim aplikasi, lalu ikuti wawancara."],
] as const;

const UMBRELLA_STEPS = [
  ["Pilih sekolah", "Tentukan SMP, SMK, atau SMA lalu isi data anak."],
  ["Masuk akun", "Google atau kode dari email. Satu akun untuk beberapa anak."],
  ["Lengkapi berkas", "Unggah dokumen yang diminta panitia sekolah."],
  ["Bayar", "Pembayaran lewat Midtrans; status dibaca dari sistem."],
  ["Kirim", "Kirim aplikasi lalu ikuti jadwal wawancara."],
] as const;

const Steps = ({
  steps,
  heading,
  description,
}: {
  steps: readonly (readonly [string, string])[];
  heading: string;
  description: string;
}) => (
  <section className={SECTION}>
    <div className={`${WIDTH} flex flex-col gap-7`}>
      <SectionHeading head={{ heading, description, linkLabel: null, linkHref: null }} />
      <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {steps.map(([title, body], index) => (
          <li key={title} className="flex flex-col gap-2 rounded-xl border border-border p-4">
            <span className="bg-surface-brand flex size-7 items-center justify-center rounded-4xl text-[13px] font-bold tabular-nums">
              {index + 1}
            </span>
            <h3 className="text-[17px] font-bold text-pretty">{title}</h3>
            <p className="text-[13px] text-muted-foreground">{body}</p>
          </li>
        ))}
      </ol>
    </div>
  </section>
);

async function LiveUmbrellaStatus({ admissionCta }: { admissionCta: string }) {
  // One call per school, three times. There is no multi-school endpoint and
  // asking for one would be asking three answers to agree when they already
  // cannot disagree: the cycle row they read is shared.
  const facts = await Promise.all(SCHOOLS.map((school) => getCycleFacts(school.key)));
  return <UmbrellaStatus facts={facts} admissionCta={admissionCta} />;
}

/**
 * Every school's cycle, as a table on a desktop page and as one card per school
 * below it. Six columns do not fit 834px, and a squeezed table is how a parent
 * reads the wrong school's closing date.
 */
function UmbrellaStatus({
  facts,
  admissionCta,
}: {
  facts: readonly CycleFacts[] | null;
  admissionCta: string;
}) {
  const rows = facts
    ? SCHOOLS.map((school, index) => ({ school, facts: facts[index]! }))
    : SCHOOLS.map((school) => ({ school, facts: null }));

  // Whichever school answers, it answers with the same cycle: membership is
  // implicit in the database, so a cycle no longer depends on a settings row and
  // the three schools cannot land on different ones. The banner can take the
  // first answer it gets. The table still speaks per school for fee and status,
  // which do differ.
  const cycle =
    (facts ?? []).flatMap((entry) => (entry.state === "cycle" ? [entry.cycle] : []))[0] ?? null;
  const unavailable = facts?.every((entry) => entry.state === "unavailable") ?? false;

  return (
    <section className={SECTION}>
      <div className={`${WIDTH} flex flex-col gap-6`}>
        <div className="flex flex-col gap-5 rounded-xl border border-border p-6 md:p-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-2 lg:max-w-[65ch]">
            <h2 className="text-2xl font-bold text-balance">
              {cycle ? `Pendaftaran bersama ${cycle.name}` : "Pendaftaran bersama"}
            </h2>
            <p className="text-sm text-pretty text-muted-foreground">
              {unavailable
                ? "Status, tanggal, dan biaya dibaca dari sistem pendaftaran dan sedang tidak dapat dihubungi. Kami tidak menampilkan tanggal lama."
                : cycle
                  ? `Hasil diumumkan serentak ${formatDate(cycle.resultPublishAt)} untuk ketiga sekolah.`
                  : "Jadwal pendaftaran berikutnya diumumkan di halaman ini."}
            </p>
          </div>
          <Actions
            state={
              facts === null
                ? "loading"
                : unavailable
                  ? "unknown"
                  : anySchoolOpen(facts)
                    ? "open"
                    : "closed"
            }
            admissionCta={admissionCta}
          />
        </div>

        <div className="hidden lg:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted text-left">
                {["Sekolah", "Status", "Dibuka", "Ditutup", "Biaya sekolah"].map((column) => (
                  <th
                    key={column}
                    className="px-4 py-3 text-xs font-bold tracking-wide text-muted-foreground uppercase"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ school, facts: entry }) => {
                const row = entry?.state === "cycle" ? entry.cycle : null;
                return (
                  <tr key={school.key} className="border-b border-border">
                    <th scope="row" className="px-4 py-4 text-left font-semibold">
                      {school.name}
                    </th>
                    <td className="px-4 py-4">
                      <SchoolStatusBadge facts={entry} />
                    </td>
                    <td className="px-4 py-4 tabular-nums">
                      {row ? formatDate(row.registrationOpenAt) : "—"}
                    </td>
                    <td className="px-4 py-4 tabular-nums">
                      {row ? formatDate(row.registrationCloseAt) : "—"}
                    </td>
                    <td className="px-4 py-4 tabular-nums">
                      {row ? formatFee(row.effectiveFee) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:hidden">
          {rows.map(({ school, facts: entry }) => {
            const row = entry?.state === "cycle" ? entry.cycle : null;
            return (
              <article
                key={school.key}
                className="flex flex-col gap-3 rounded-xl border border-border p-4"
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <SchoolStatusBadge facts={entry} />
                  {row && (
                    <span className="text-[13px] text-muted-foreground tabular-nums">
                      {formatDate(row.registrationOpenAt)} – {formatDate(row.registrationCloseAt)}
                    </span>
                  )}
                </div>
                <h3 className="text-[17px] font-bold text-pretty">{school.name}</h3>
                {row && (
                  <FactStrip>
                    <Fact label="Biaya sekolah">{formatFee(row.effectiveFee)}</Fact>
                  </FactStrip>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * Status never rides on colour alone: the badge carries the word, so "Ditutup"
 * reads the same to someone who cannot tell the two fills apart.
 */
function SchoolStatusBadge({ facts }: { facts: CycleFacts | null }) {
  if (facts === null) return <span className="block h-5 w-20 rounded-4xl bg-muted" />;
  if (facts.state === "unavailable") return <Badge variant="outline">Belum bisa dibaca</Badge>;
  if (facts.state === "none") return <Badge variant="secondary">Belum dibuka</Badge>;

  const open = isOpen(facts.cycle);
  return <Badge variant={open ? "default" : "secondary"}>{open ? "Dibuka" : "Ditutup"}</Badge>;
}

/**
 * What an editor owns on this page: the FAQ, and any extra prose. Every other
 * block type renders nothing here — its own page draws it.
 */
const EditorBlocks = ({ blocks }: { blocks: readonly Block[] }) => (
  <>
    {blocks.map((block) => {
      if (block.kind === "rich-text") {
        return (
          <section key={`${block.kind}-${block.id}`} className={SECTION}>
            <div className={`${WIDTH} flex flex-col gap-3`}>
              {/* Strapi `richtext` is markdown. Paragraph splitting is all this
                  page needs; a parser arrives with the first page that wants a
                  heading or a list inside a text block. */}
              {/* Keyed by position within the block, because that is what a
                  paragraph is here: a slice of one string. Keying by the text
                  would collide the moment an editor repeats a line. */}
              {block.body
                .split(/\r?\n\s*\r?\n/)
                .map((paragraph, index) => ({ id: `${block.id}-${index}`, text: paragraph.trim() }))
                .filter((paragraph) => paragraph.text)
                .map((paragraph) => (
                  <p key={paragraph.id} className="max-w-[65ch] text-base text-pretty">
                    {paragraph.text}
                  </p>
                ))}
            </div>
          </section>
        );
      }

      if (block.kind === "faq") {
        return (
          <section key={`${block.kind}-${block.id}`} className={`${SECTION} bg-muted`}>
            <div className={`${WIDTH} flex flex-col gap-7`}>
              <SectionHeading head={block.head} />
              <div className="flex max-w-[75ch] flex-col">
                {block.items.map((item) => (
                  // `<details>`, not a scripted accordion: it opens before any
                  // JavaScript loads, answers the keyboard on its own, and is
                  // searchable in the page. Nothing here needs more.
                  <details
                    // The component row's own id, not the question text: two
                    // identical questions are an editing mistake the CMS does
                    // not forbid, and a duplicate key reuses the wrong panel.
                    key={item.id}
                    className="faq-item group border-b border-border [&_summary::-webkit-details-marker]:hidden"
                  >
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[17px] font-semibold">
                      {item.question}
                      <span
                        aria-hidden
                        className="text-muted-foreground transition-transform duration-200 ease-out group-open:rotate-45 motion-reduce:transition-none"
                      >
                        +
                      </span>
                    </summary>
                    <p className="max-w-[65ch] pb-4 text-sm text-pretty text-muted-foreground">
                      {item.answer}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        );
      }

      return null;
    })}
  </>
);

/**
 * The committee's own contacts, read from the CMS.
 *
 * Asking is the most-used path on the old site by a wide margin, so it gets a
 * section rather than a line in the footer. The icon follows the link's scheme;
 * no contact link ever carries anything about the visitor.
 */
const Contacts = ({ site }: { site: Site }) =>
  site.contacts.length === 0 ? null : (
    <section className={SECTION}>
      <div className={`${WIDTH} flex flex-col gap-7`}>
        <SectionHeading
          head={{
            heading: "Masih ada yang mau ditanyakan?",
            description: "Panitia menjawab lewat WhatsApp dan email pada jam kerja.",
            linkLabel: null,
            linkHref: null,
          }}
        />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {site.contacts.map((contact) => {
            const Icon = contactIcon(contact.href);
            return (
              <a
                key={contact.href}
                href={contact.href}
                className="flex min-h-11 flex-col gap-1 rounded-xl border border-border p-4 hover:border-primary"
              >
                <span className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                  <Icon aria-hidden className="size-4" strokeWidth={1.75} />
                  {contact.label}
                </span>
                <span className="text-[15px] font-semibold text-pretty">{contact.value}</span>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );

function contactIcon(href: string) {
  if (href.startsWith("mailto:")) return Mail;
  if (href.startsWith("tel:")) return Phone;
  if (href.includes("wa.me") || href.includes("whatsapp")) return MessageCircle;
  return MapPin;
}
