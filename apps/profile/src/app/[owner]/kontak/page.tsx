import { SCHOOLS } from "@mbs/school-config";
import { buttonVariants } from "@mbs/ui/components/button";
import { ExternalLink, MessageCircle, Phone } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";

import { getPage, getSite, type Block, type Site } from "../../../cms.ts";
import { OWNERS, ownerUrl, type Owner } from "../../../owners.ts";
import { AdmissionBandSection, PageHead, SECTION, SectionHeading, WIDTH } from "../sections.tsx";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) return {};

  const page = await getPage(owner.key, "kontak");
  return {
    title: page?.seo?.metaTitle ?? "Kontak",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

/**
 * The contact page, for a school and for the umbrella.
 *
 * Asking is the primary action here rather than a footnote: the old site's two
 * most-used pages by a wide margin were both question forms, neither carrying a
 * word of copy. So the page opens with the two ways to ask — the admission
 * committee and everyone else, kept apart exactly as those two forms were — and
 * the address facts come after them.
 *
 * No form ships. WhatsApp and email need no backend and match how parents here
 * actually ask; a stored question belongs in the core API, not in Strapi, and is
 * deferred rather than rejected.
 */
export default async function ContactPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: key } = await params;
  const owner = OWNERS.find((candidate) => candidate.key === key);
  if (!owner) notFound();

  const [site, page] = await Promise.all([getSite(owner.key), getPage(owner.key, "kontak")]);
  const school = SCHOOLS.find((candidate) => candidate.key === owner.key);

  return (
    <main>
      <PageHead
        heading="Kontak"
        body={
          school
            ? "Pertanyaan pendaftaran dan pertanyaan umum ditangani dua orang berbeda. Pilih yang sesuai."
            : "Pertanyaan pendaftaran dijawab panitia bersama; urusan yayasan lewat sekretariat."
        }
      />

      {(page?.blocks ?? []).map((block) =>
        block.kind !== "contact" ? null : (
          <Fragment key={`${block.kind}-${block.id}`}>
            <AskCards items={block.items} />
            {school ? (
              <Address owner={owner} site={site} head={block.head} showMap={block.showMap} />
            ) : (
              <SchoolDirectory
                owner={owner}
                site={site}
                head={block.head}
                showMap={block.showMap}
              />
            )}
          </Fragment>
        ),
      )}

      {school && <AdmissionBandSection schoolKey={school.key} admissionCta={site.admissionCta} />}
    </main>
  );
}

type ContactBlock = Extract<Block, { kind: "contact" }>;

/**
 * The two ways to ask, side by side.
 *
 * Each card names who answers and what they answer about, because the whole
 * point of keeping them apart is that a parent picks the right one. The number
 * is a link of its own as well as a button: on a phone the button opens
 * WhatsApp, and on a desktop page the number is what somebody copies.
 */
const AskCards = ({ items }: { items: ContactBlock["items"] }) =>
  items.length === 0 ? null : (
    <section className={SECTION}>
      <div className={`${WIDTH} grid gap-4 md:grid-cols-2`}>
        {items.map((item) => {
          const whatsapp = item.channelHref.includes("wa.me");
          const Icon = whatsapp ? MessageCircle : Phone;
          return (
            <article
              // The component row's own id: two cards can carry the same title
              // without the content model forbidding it.
              key={item.id}
              className="bg-surface-brand flex flex-col gap-4 rounded-xl border border-border p-6"
            >
              <div className="flex flex-col gap-1.5">
                <h2 className="text-xl font-bold text-pretty">{item.title}</h2>
                {item.description && (
                  <p className="max-w-[65ch] text-sm text-pretty text-muted-foreground">
                    {item.description}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <a
                  href={item.channelHref}
                  className="flex min-h-11 items-center gap-2 text-lg font-bold tabular-nums"
                >
                  <Icon aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
                  {item.channelValue}
                </a>
                {item.hours && <p className="text-[13px] text-muted-foreground">{item.hours}</p>}
              </div>

              <div className="flex flex-col gap-2">
                <a
                  href={item.channelHref}
                  className={buttonVariants({ size: "touch", className: "w-fit" })}
                >
                  {item.ctaLabel}
                </a>
                {item.email && (
                  <a
                    href={`mailto:${item.email}`}
                    className="flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4 md:min-h-0"
                  >
                    {item.email}
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );

/** Where the school is, when it answers, and where to follow it. */
function Address({
  owner,
  site,
  head,
  showMap,
}: {
  owner: Owner;
  site: Site;
  head: ContactBlock["head"];
  showMap: boolean;
}) {
  const email = site.contacts.find((contact) => contact.href.startsWith("mailto:"));
  // No pin, no second column: an owner without coordinates would otherwise
  // leave half the row empty on every desktop page.
  const coordinates = showMap ? site.mapsCoordinates : null;

  return (
    <section className={`${SECTION} bg-muted`}>
      <div className={`${WIDTH} flex flex-col gap-7`}>
        <SectionHeading head={head} />
        <div className={`grid gap-6 ${coordinates ? "lg:grid-cols-2" : ""}`}>
          <div className="flex flex-col gap-6">
            <Facts>
              {site.address && <Fact label="Alamat">{site.address}</Fact>}
              {site.headerPhone && (
                <Fact label="Telepon kantor">
                  <a href={site.headerPhone.href} className="tabular-nums">
                    {site.headerPhone.label}
                  </a>
                </Fact>
              )}
              {email && (
                <Fact label="Email umum">
                  <a href={email.href}>{email.value}</a>
                </Fact>
              )}
              {site.hours && <Fact label="Jam layanan">{site.hours}</Fact>}
            </Facts>
            <Socials links={site.socials} />
          </div>
          {coordinates && <Map name={owner.name} coordinates={coordinates} />}
        </div>
      </div>
    </section>
  );
}

/**
 * Each school's own number and email, read from that school's `Site` row.
 *
 * Read rather than typed into the umbrella's CMS: these are school-owned facts,
 * and a second copy at the apex is a second place to forget when a number
 * changes. This is the one page that reads across owners, and it reads only what
 * every school already publishes on its own contact page.
 */
async function SchoolDirectory({
  owner,
  site,
  head,
  showMap,
}: {
  owner: Owner;
  site: Site;
  head: ContactBlock["head"];
  showMap: boolean;
}) {
  // Tolerated per school, unlike everywhere else `getSite` is called. A missing
  // row is still a broken deployment, but this is the one page that reads
  // another owner's, and one unreadable school must not take the apex's contact
  // page down with it. The school keeps its row and says what is missing.
  const schools = await Promise.all(
    SCHOOLS.map(async (school) => {
      try {
        return { school, site: await getSite(school.key) };
      } catch {
        return { school, site: null };
      }
    }),
  );
  const coordinates = showMap ? site.mapsCoordinates : null;

  return (
    <section className={`${SECTION} bg-muted`}>
      <div className={`${WIDTH} flex flex-col gap-7`}>
        <SectionHeading head={head} />
        <div className={`grid gap-6 ${coordinates ? "lg:grid-cols-2" : ""}`}>
          <div className="flex flex-col gap-6">
            <Facts>
              {schools.map(({ school, site: schoolSite }) => {
                const phone = schoolSite?.headerPhone;
                const email = schoolSite?.contacts.find((contact) =>
                  contact.href.startsWith("mailto:"),
                );
                return (
                  <Fact key={school.key} label={school.name}>
                    {schoolSite ? (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {phone && (
                          <a href={phone.href} className="tabular-nums">
                            {phone.label}
                          </a>
                        )}
                        {phone && email && (
                          <span aria-hidden className="text-muted-foreground">
                            ·
                          </span>
                        )}
                        {email && <a href={email.href}>{email.value}</a>}
                      </span>
                    ) : (
                      // The school stays on the page: dropping the row would
                      // read as a school that has no contact rather than one we
                      // could not read.
                      <span className="text-muted-foreground">
                        Kontak belum bisa dibaca.{" "}
                        <a href={ownerUrl(school)} className="underline underline-offset-4">
                          Buka situs sekolah
                        </a>
                      </span>
                    )}
                  </Fact>
                );
              })}
              {site.address && <Fact label="Alamat kampus">{site.address}</Fact>}
              {site.hours && <Fact label="Jam layanan">{site.hours}</Fact>}
            </Facts>
            <Socials links={site.socials} />
          </div>
          {coordinates && <Map name={owner.name} coordinates={coordinates} />}
        </div>
      </div>
    </section>
  );
}

// A list of labelled facts, one per row. The label sits beside the value from
// tablet up and above it on a phone, where two columns would leave an address
// four words wide.
const Facts = ({ children }: { children: ReactNode }) => (
  <dl className="flex flex-col rounded-xl border border-border bg-background">{children}</dl>
);

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-0.5 border-b border-border px-4 py-3.5 last:border-b-0 md:flex-row md:gap-6 md:px-5">
    <dt className="text-[13px] font-semibold text-muted-foreground md:w-44 md:shrink-0">{label}</dt>
    <dd className="text-sm text-pretty">{children}</dd>
  </div>
);

/**
 * The official accounts, each a 44px row with its own name.
 *
 * Labelled rather than icon-only: an icon alone names nothing to a screen
 * reader and reads as decoration to everyone else. One neutral icon for all
 * three, because lucide carries no brand glyphs and a second icon library for
 * three logos is not a trade worth making.
 */
const Socials = ({ links }: { links: Site["socials"] }) =>
  links.length === 0 ? null : (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
        Media sosial
      </h3>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            // A new tab, because the account is somebody else's site and a
            // parent halfway through reading a contact page should not lose it.
            // `rel` is what keeps that tab from reaching back into ours.
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center gap-2 text-sm font-semibold text-primary underline underline-offset-4"
          >
            <ExternalLink aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );

/**
 * The campus on a map, plus the link that opens it properly.
 *
 * Coordinates rather than the address, because a search on a placeholder street
 * name lands somewhere plausible and wrong. `loading="lazy"` keeps Google's
 * frame — and the request to Google that comes with it — out of the first paint;
 * the link below works whether or not the frame ever loads.
 */
const Map = ({ name, coordinates }: { name: string; coordinates: string }) => {
  const query = encodeURIComponent(coordinates);
  return (
    <div className="flex flex-col gap-2">
      {/* No `sandbox`: the map needs scripts and its own origin, and that pair
          is exactly what a sandbox cannot grant together. The escape a sandbox
          guards against is a framed document reaching its framer's origin — and
          this document is Google's, not ours, so there is nothing of ours in
          there to reach. Framing a same-origin page would be the opposite case
          and must keep the attribute. */}
      {/* oxlint-disable-next-line react/iframe-missing-sandbox */}
      <iframe
        title={`Peta lokasi ${name}`}
        src={`https://www.google.com/maps?q=${query}&output=embed`}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        // Google's embed has no dark mode, so a lit rectangle would sit in the
        // middle of a dark page. Inverting and rotating the hue back is the only
        // lever we have from outside the frame: roads go dark and labels go
        // light, at the cost of greens reading slightly off. Better than a hole.
        className="min-h-72 w-full flex-1 rounded-lg border border-border dark:[filter:invert(0.92)_hue-rotate(180deg)]"
      />
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${query}`}
        target="_blank"
        rel="noreferrer"
        className="flex min-h-11 items-center gap-2 text-sm font-semibold text-primary underline underline-offset-4"
      >
        Buka di Google Maps
      </a>
    </div>
  );
};
