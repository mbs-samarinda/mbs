# Product

<!-- impeccable:product-schema 1 -->

Product truth for this repository. The decisions behind it live in
[`mbs-samarinda/knowledge`](https://github.com/mbs-samarinda/knowledge),
usually checked out alongside this repository. It is the authority; this file summarises what design work must preserve. If the two
disagree, fix the stale one.

## Platform

web

## Users

**Parents and guardians** are the primary applicant-facing users. One parent
account may manage applications for several children. They work on their own,
on the public internet, mostly on mid-range Android phones and often on patchy
mobile data, and complete the process over several sittings. The child is the subject of an application, never a login identity.

Other audiences, each with a different job:

- **Prospective families** — parents comparing schools, prospective students,
  current families after official information, and visitors arriving from
  search. They browse a school profile site before applying.
- **Staff** — most review work: inspect, request precise revisions, verify,
  manage interviews, record decisions.
- **Administrators** — staff abilities plus school settings, staff access,
  exports and fee waivers within their assigned schools, and the admission
  cycle, which is shared across MBSS and carries no school of its own.
- **Principals** — read-only visibility into applicants and results. Not a
  hidden approval step; they cannot change records.
- **School content editors** — maintain their school's public profile content
  in Strapi, without touching admission.

## Product Purpose

One connected digital system for the MBSS schools: a public presence per
school, a clear registration path for families, and one workspace for the
admission committee. It replaces paper forms, WhatsApp threads, spreadsheets
and payment screenshots with one record.

Success, stated as observable outcomes:

- A visitor understands a school and finds admission without asking anyone.
- A parent leaves and resumes a draft without losing progress.
- A parent managing several children never confuses one application with
  another.
- A staff member understands an application's whole condition from one
  workspace.
- Revision requests name exactly what must change.
- Payment, review, interview and result states cannot contradict one another.
- An editor keeps content current without affecting another school or
  admission.
- The organisation can explain who changed an important record, and when.

## Positioning

MBSS is one organisation with a known set of schools, not a platform schools
sign up for. That shapes the system: the school list is a compile-time constant
(`packages/school-config`), while anything an administrator changes — fees,
dates, whether a school takes part in a cycle — lives in PostgreSQL. Shared
admission rules are coordinated centrally; school-owned content and staff
access stay scoped to their school.

Explicit non-goals: not a website builder, not a generic form builder, not a
school ERP, not a learning system, not a marketplace for independent schools.

## Operating Context

Four applications, one service:

| App | Job |
| --- | --- |
| `apps/profile` (Next.js) | Public profile sites: umbrella at the apex, one school per subdomain |
| `apps/admission` (Vite) | Parent application |
| `apps/admission-admin` (Vite) | Committee workspace |
| `apps/cms` (Strapi) | Profile content only, own database |
| `apps/api` (Fastify + oRPC) | Sole source of truth for admission |

Three schools, one system, each with its own identity, fees and dates: SMP
Islam Terpadu Madina, SMK Terpadu Madina, SMA Madina Citra Insani. Hostname
resolves the owner.

Public content belongs to one of four **owners**: the `mbs` Madina Boarding
School umbrella at the apex, and the three schools. Only the three schools are
`SchoolKey` values. The umbrella has public content but never a cycle, an
application, a fee or staff access, so it is deliberately not a fourth
`SchoolKey` — that would force a "not the umbrella" guard through the whole
admission domain.

Admission runs in cycles (`DRAFT`, `OPEN`, `CLOSED`, `ARCHIVED`) with
registration open/close and a shared result publish time, plus per-school
settings inside a cycle.

Parent journey: choose school and enter child basics, authenticate (Google or
email OTP), receive a public registration number, complete applicant and
guardian data, upload required documents, pay through Midtrans, review, submit,
answer any revision requests, attend an interview, then see the result at the
shared publication time.

Profile sites: each school has its own address (`sma.mbss.sch.id` and so on)
but all belong to one product. A visitor should quickly find what the school is
and whom it serves, its programs, values, facilities and activities, news and
contact details, whether admission is open, and how to start. School pages are
`/`, `/profil`, `/program`, `/ekstrakurikuler`, `/fasilitas`, `/berita`,
`/pendaftaran`, `/kontak`. `program` is the academic offering and carries SMK's
jurusan; `ekstrakurikuler` is activities. They are separate pages because they
answer separate questions.

The apex, `mbss.sch.id`, is the umbrella site: identity, the three schools, and
the joint admission campaign. It is not a fourth school profile, so it carries
no facilities, activities, staff or achievements — a visitor landing there is
choosing a school. Yapendis Nurul Haq is content on it, never the identity of
it. Its admission page reads every school's facts through
`public.admission.getCurrentCycle`, once per school; the cycle is one shared row
so the answers cannot disagree.

`/berita` is one listing over two content types, Berita and Pengumuman, each
with a visible type label. `Pengumuman` carries an optional `expiresAt`.
`Pencapaian` is a record browsed by level and year rather than a feed entry, and
may optionally point at one Berita article telling the story behind it. The name
is `Pencapaian` and not `Prestasi` because the admission domain uses Prestasi for
a Jalur.

Editors compose pages from approved sections — hero, introduction, programs,
facilities, gallery, statistics, FAQ, news, pencapaian, admission invitation,
contact — choosing order, text, images, navigation, SEO and the school's tagline.
Its palette is not theirs to set: approved per school, fixed in
`@mbs/school-config`. They cannot add arbitrary page code, CSS, fonts or unrelated layouts, and
they never maintain a second admission opening date: the invitation reads the
current period from the admission service. Umbrella content is editable only by
a global content administrator, never by a school editor. The profile site sends
a parent to the admission app; it never collects applications, authenticates
parents, takes payment or reads private records. An unknown hostname must not
quietly show another owner's content.

No contact form ships initially — WhatsApp and email carry it. That is a
deferral, not a rejection: the two most-used pages on the previous site were
both question forms, by a wide margin, so a form that stores the question and
notifies the panitia is planned for the core API and the committee workspace.
No content is migrated from the old sites; this is a fresh start.

Committee journey: a dense applicant queue filtered by cycle, school and status
with filter state in the URL, then one applicant workspace holding applicant,
guardians, previous education, documents, payment, review issues, interview,
decision and audit history.

## Capabilities and Constraints

- The API decides. Front ends render state; they never own it. Apps never
  import each other's source — they talk over HTTP.
- Application state, payment state, document state and decision are related but
  distinct. The interface may summarise them; it must never let one imply
  another. A successful payment is not a submission.
- Submission is deliberate and explicit, never a side effect of checkout. It
  succeeds only when the cycle is `OPEN` and the school enabled, the
  application is the parent's and is `DRAFT`, required fields are complete,
  every snapshotted required document is uploaded, and the fee is `PAID` or
  `WAIVED`.
- After submission the application locks. Only fields and documents named in an
  open revision issue become editable; resubmitting means "the parent says this
  is fixed", not "staff approved it". The API enforces this, not disabled
  controls.
- Midtrans is authoritative for payment status. The browser returning from
  checkout is informational only; the shown state comes from the admission
  service. Failed and expired attempts stay as history and can be retried.
  Waivers need an administrator, a reason and an audit record.
- Results may be stored before publication but must not be exposed or implied
  before `result_publish_at`. Viewing a result requires an authenticated parent
  with access; no public registration-number lookup.
- Privacy: a registration number is safe to quote to staff but unlocks nothing.
  Duplicate-registration messages must not reveal another child's identity.
  Documents go to private S3.
- Better Auth owns authentication tables; the MBSS domain owns authorization
  (`application_access`, `staff_users`, `staff_school_access`). Database-backed
  sessions with host-only HTTP-only cookies, so applicant and staff sessions
  never mix. Staff sign in with Google; there is no SUPER_ADMIN.
- Every important change is auditable (`audit_logs`: actor, action, entity,
  metadata).
- The selected application lives in the route, never in a hidden "active child"
  in the session. Two tabs may safely hold two children.
- Applicant-facing copy is Bahasa Indonesia. No Arabic script anywhere in the
  applications: no Arabic typeface, no RTL layout, no Arabic content fields.
- Two control densities share one component set: 44px touch targets on
  parent-facing surfaces, the compact 24–36px scale for committee and CMS work.
- Contract and Zod schemas live in `packages/api-contract`; Drizzle schema and
  migrations in `packages/db`, used by the API alone. `packages/ui` holds the
  shared shadcn/ui components on Base UI and the design tokens.
- Current state: `apps/admission` is a one-route shell. The registration flow
  is unbuilt. `apps/admission-admin` has sign-in, gate and a staff screen.
  `apps/profile` is a one-route shell, but it now resolves all four owners and
  wears each one's palette; `apps/cms` has no content types at all. The rest of
  the profile decisions above are agreed and documented, not implemented.

## Brand Commitments

Binding, from `docs/brand/brand-guide.md` in the knowledge repository. Read it
before any visual work; the summary below is a pointer, not a substitute.

- Endorsed-brand model, three layers: Yayasan Pendidikan dan Dakwah Islam Nurul
  Haq Samarinda (legal), Madina Boarding School (public umbrella), then the
  three schools. Never label the Madina mark as the Yapendis logo. Never
  shorten an identity to just "Madina".
- Umbrella promise: *Mencetak Generasi Qur'ani, Berprestasi & Berdaya Saing* —
  umbrella surfaces only. Each school carries its own tagline instead: SMP
  *Sekolahnya Anak Saleh, Unggul & Berkarakter*, SMK *Berakhlak Mulia Siap
  Berkarya*, SMA *Islami Unggul Mandiri*. Never both on one surface, and neither
  in transactional forms or staff tools. The taglines seed the CMS `Site.tagline`
  field and an editor may reword their own; where a tagline may appear stays a
  brand rule. The umbrella row holds the promise and is administrator-only.
- Personality: Islamic and principled, warm and reassuring, capable and
  disciplined, aspirational, contemporary, local and human. Never luxurious,
  childish, bureaucratic, aggressively promotional or crowded.
- Palette `#18a698` primary, `#126e84` dark primary (carries white text),
  `#f26420` warm accent, `#1389a7` supporting. Orange is never the error color.
  School colors never redefine payment, validation or workflow states. Color is
  never the only indicator.
- Typography: Plus Jakarta Sans, one family. No Arabic typeface.
- Voice by audience: address parents as "Anda", the role as "orang tua/wali",
  never "Ayah/Bunda" universally, never blame the parent for a validation,
  provider or connection failure. Staff copy is direct and operational.
- Intensity per app: profile expressive, parent admission reassuring, committee
  operational, CMS restrained, campaigns energetic. Campaign intensity never
  becomes the default for forms or daily tools.
- Photography is authentic documentary work with consent. Applicant uploads are
  never marketing sources.
- Depth: one elevation step, carried by shadow, for surfaces that float;
  resting controls including buttons are flat. Borders keep structure, state
  and focus. The guide's original flat direction was amended to a two-step
  system on 8 September 2026 and narrowed to this single step on 10 September
  2026, both approved by the brand owner.
- Each school owns an approved palette on its own profile site: SMP `#1A6B3F`,
  SMK `#1D63C4`, SMA `#B01C2E`, each with a hover shade, one dark-text accent, a
  surface tint and a focus ring. Approved 12 September 2026; SMA's maroon
  replaced the guide's earlier blue direction.
- Deliberately unresolved, must not be invented: authoritative Yapendis logo,
  vector artwork for any mark, logo construction rules, final neutral token
  values, component specs. The semantic status values were settled on 10
  September 2026.

**Token state:** `packages/ui/src/styles/globals.css` now ships Plus Jakarta
Sans and one of the four guide colors: `--primary` (the dark primary,
`#126e84`, the only one that carries white text), plus `--primary-hover` and a
`--ring` derived from it. Madina Teal, Ember Orange and the supporting blue-teal
have no consumers yet, so no tokens ship for them — they live in DESIGN.md until
a surface needs them. All four approved status pairs now ship
as `--<name>-surface` and `--<name>-ink`, consumed by the `Badge` variants of
the same names: the committee queue shows form, document, payment and review
state together, which is the consumer the other three were waiting for. One elevation token ships:
`--shadow-overlay`.

Four owner palettes are approved — the three schools plus the umbrella — and
they ship as one CSS custom property block per owner in
`apps/profile/src/app/globals.css`, light and dark, keyed off a `data-owner`
attribute. Not a table in TypeScript: a copy in code would be a second place to
keep in step. `packages/ui` never learns an owner exists; components keep using
`bg-primary` and `ring-ring`, and the cascade does the rest.

`data-owner` goes on `<html>`, set by the root layout, which lives inside the
segment at `app/[owner]/layout.tsx`. It has to be that high because a dialog or
a menu portals into `document.body`, so a wrapper element further down would
leave them on shared teal, and the dark blocks match same-element as
`.dark[data-owner="smp"]` where the theme class also sits. Narrowing the
segment param there is also the only guard on the segment: paths the proxy
matcher skips arrive with that path as the owner key, and without it they would
serve the first owner's content under another owner's hostname.

Every owner page prerenders as static, which is what this position buys. The
cost is the 404: Next's not-found boundary sits above the root layout, so an
unclaimed path answers with Next's own document — correct status, no
stylesheet, no owner. A `not-found.tsx` in the segment does not claim it, and
neither does one beside a `[...rest]` catch-all calling `notFound()`; both were
built and measured against a running server and both still returned
`<html id="__next_error__">`. The way to a styled 404 is a root layout above the
segment reading the owner from a proxy header, which works but makes every
route `ƒ (Dynamic)` because Cache Components will not prerender a shell that
reads a header. Static public pages were judged worth more than a styled 404.

Two roles the shared layer has no token for arrive with the blocks:
`--accent-brand` (the Rare Orange rule; `--accent` is already the neutral hover
fill) and `--surface-brand` for a tinted band. Both are registered in a
`@theme inline` block beside them, so `bg-accent-brand` and `bg-surface-brand`
resolve — without the alias the class compiles to nothing and the element comes
out transparent with no build error.

Each owner's `<title>` and description are its own, from `generateMetadata` in
the same layout that already resolved the owner, so the pages stay static. The
description is a placeholder until the CMS owns SEO defaults.

An owner is not a school. The umbrella has a site, a palette and content but no
admission cycle, no staff scope and no row in the schools table, so `OWNERS`
lives in `apps/profile` and `SCHOOLS` stays the three-school list the admission
side means by the word. `schoolFromHostname` is gone; owner resolution replaced
its only caller, and an unknown host resolves to nobody rather than falling
back to the umbrella. `localhost` and `smk.localhost` resolve the same way as
the real hosts, so the app is runnable locally.

Verified against the running build: `/` on `sma.mbss.sch.id` answers
`<html lang="id" data-owner="sma">` with the stylesheet and that school's
colour, `/about` answers 404 from Next's own document, `/favicon.ico` answers
404 rather than the umbrella's page, `localhost` resolves to the umbrella, and
an unknown host is refused before any page renders.

One warning to act on separately: Next 16 deprecates the `middleware` file
convention in favour of `proxy`. There is a codemod.

The alarm pair now ships as `--destructive` plus `--destructive-tint`, the
guide's approved ink on its approved tint. Before this it was shadcn's stock red
with the tint faked by alpha, which measured 3.99:1 resting and 3.32:1 on hover
in the destructive button and badge. `packages/ui/test/contrast.test.ts` asserts
the ratio so the value cannot drift back.

`--muted-foreground` was shadcn's `#737373`, which measures 4.35:1 on a tinted
band — under the floor for normal text, on a design full of tinted bands. It is
now `#6e6e6e`: 4.68:1 on the tint, 5.10:1 on white. Still awaiting the guide's
approval: the warm-neutral family the surfaces should eventually become (what
ships is a gray ramp) and the chart ramp. Two things for
whoever approves them: Ember Orange at hue 42 would sit 13.5 degrees from the
alarm ink at 28.5, so error and warm accent would read as one family, and the
guide says orange is never the error color. Nothing ships that clash today —
Ember Orange has no token yet — but it lands the moment one is added. Dark mode is approved for the public
profile sites as of 12 September 2026: a neutral ramp, a lighter variant of each
school palette that carries dark text, and inverted status pairs, all recorded in
the brand guide. It is a token swap, not a second design. The existing `.dark`
block in `globals.css` predated that approval and carried derived values; it now
carries the ramp, except for the `--sidebar-*` family and the deferred chart
ramp, which are flagged in the file as still pre-approval and are consumed by
nothing. Page and card share `#141414`, so separation comes from the
hairline rather than a lighter card, and the primary label follows paper, which
is white on a light page and near-black on a dark one. Owner primaries are not
in there — they arrive with the per-owner blocks. Admission, committee and CMS
stay light-only until separately approved, and no app toggles `.dark` yet.

Mostly closed: the focus pattern. `Button`, `Input`, `Select` and `Checkbox`
already drew a solid 2px ring offset 2px from the control, which is what
DESIGN.md specifies; `Badge`, `Textarea`, `InputGroup` and `Calendar` had kept
shadcn's 3px halo at 50% opacity, measuring 1.77:1 against a primary fill. All
four now use a solid indicator with a 2px gap, which is what lets the ring skip
needing contrast against the fill it surrounds.

What is left is the gap itself. `ring-offset` paints it as a solid band of
`--background`, so it only vanishes on the page ground — in a dialog footer or a
table header it reads as a mismatched line. The calendar could not use it at all,
since day cells abut and the band cut through a selected range, so it uses
`outline` with a transparent offset instead. One `:focus-visible` rule in the base
layer would give every control the transparent gap and delete the per-component
classes; it touches every app, so it wants its own change.

Still open, and the same class of problem the alarm pair turned out to be: this
file claims all four status pairs ship as `--<name>-surface` and `--<name>-ink`
with matching `Badge` variants. They do not. `globals.css` has no success,
warning or information token, and `Badge` has no such variant — only the alarm
pair ships, as `--destructive` and `--destructive-tint`. Either the three pairs
get built or that sentence goes.

## Evidence on Hand

- Knowledge repository: 13 numbered docs, four concept docs, four page-map
  docs, brand guide and reference-asset inventory.
- `docs/brand/reference-assets.md` inventories five flattened JPEG references
  with SHA-256 hashes, under `assets/brand/reference/` in that repository: the
  Madina Boarding School umbrella mark, the SMP IT Madina, SMK Terpadu Madina
  and SMA MCI marks, and a joint PPDB 2027/2028 poster. They are white-background
  flattened files with compression and scaling artifacts — reference evidence
  only. Do not sample colors from them, auto-trace them, or ship them as
  production logos.
- The poster is evidence that a joint Madina admission campaign exists, with
  all three schools in one message and real student photography central. Its
  dark green, warm gold and cream informs campaign expression only; everyday
  screens do not copy it.
- Still missing and required before logo rules can exist: vector or
  highest-resolution sources for each mark, confirmation of approved variants,
  an authoritative Yapendis logo if one exists, and a documented approval
  contact per identity.
- No testimonials, enrolment figures, press or case studies exist. Do not
  invent any, and do not make "best school" claims without substantiation.

## Product Principles

- **Clear over clever.** Every screen answers: where am I, what is the state,
  what do I do next.
- **One trustworthy record.** Each fact has one responsible source; apps
  present it and never invent a second version.
- **Precise feedback.** Name the exact field or document and explain it. A bare
  "rejected" is not a review.
- **Safe by default.** Children's data. A user sees only what they are granted;
  public identifiers unlock nothing.
- **Fast on ordinary devices and connections.** No powerful phone or perfect
  connection required. Retrying an action is always safe.
- **Coordinated, not over-generalized.** Built for MBSS and its known schools.

## Accessibility & Inclusion

WCAG 2.2 AA is the minimum for public and authenticated applications. Contrast
holds in every state; meaning never relies on color alone; focus is visible and
keyboard operation complete; forms use persistent labels with associated
errors; text stays usable when enlarged; motion is restrained and respects
reduced-motion. Indonesian text explains actions without depending on icons.
Accessibility outranks exact color fidelity.
