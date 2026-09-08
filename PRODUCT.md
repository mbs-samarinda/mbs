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
- **Administrators** — staff abilities plus cycles, school settings, staff
  access, exports, fee waivers, within their assigned schools.
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
| `apps/profile` (Next.js) | School profile sites, one app per subdomain |
| `apps/admission` (Vite) | Parent application |
| `apps/admission-admin` (Vite) | Committee workspace |
| `apps/cms` (Strapi) | Profile content only, own database |
| `apps/api` (Fastify + oRPC) | Sole source of truth for admission |

Three schools, one system, each with its own identity, fees and dates: SMP
Islam Terpadu Madina, SMK Terpadu Madina, SMA Madina Citra Insani. Hostname
resolves the school (`schoolFromHostname`).

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
contact details, whether admission is open, and how to start. Editors compose
pages from approved sections — hero, introduction, programs, facilities,
gallery, statistics, FAQ, news, admission invitation, contact — choosing order,
text, images, navigation, SEO and the school's primary color. They cannot add
arbitrary page code, CSS, fonts or unrelated layouts, and they never maintain a
second admission opening date: the invitation reads the current period from the
admission service. The profile site sends a parent to the admission app; it
never collects applications, authenticates parents, takes payment or reads
private records. An unknown hostname must not quietly show another school's
content.

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

## Brand Commitments

Binding, from `docs/brand/brand-guide.md` in the knowledge repository. Read it
before any visual work; the summary below is a pointer, not a substitute.

- Endorsed-brand model, three layers: Yayasan Pendidikan dan Dakwah Islam Nurul
  Haq Samarinda (legal), Madina Boarding School (public umbrella), then the
  three schools. Never label the Madina mark as the Yapendis logo. Never
  shorten an identity to just "Madina".
- Umbrella promise: *Mencetak Generasi Qur'ani, Berprestasi & Berdaya Saing*.
  Not for transactional forms or staff tools.
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
- Depth: two elevation steps carried by shadow (raised, overlay); borders keep
  structure, state and focus. This amended the guide's original flat direction
  on 8 September 2026, approved by the brand owner.
- Deliberately unresolved, must not be invented: authoritative Yapendis logo,
  vector artwork for any mark, logo construction rules, each school's exact
  digital primary, final neutral and semantic token values, component specs.

**Token state:** `packages/ui/src/styles/globals.css` now ships Plus Jakarta
Sans and one of the four guide colors: `--primary` (the dark primary,
`#126e84`, the only one that carries white text), plus `--primary-hover` and a
`--ring` derived from it. Madina Teal, Ember Orange and the supporting blue-teal
have no consumers yet, so no tokens ship for them — they live in DESIGN.md until
a surface needs them. Two elevation tokens ship: `--shadow-raised` and
`--shadow-overlay`.

Still stock shadcn and awaiting the guide's approval: the neutral family
(surfaces should become warm neutrals), the semantic success/warning/info
tokens, the chart ramp, and each school's digital primary. Two things for
whoever approves them: `--destructive` sits at hue 27.3 and `--warm` at 42, so
error and warm accent read as one family — the guide says orange is never the
error color, and that closeness works against it. And the dark-mode brand values are derived,
not approved: the guide specifies light mode only. Hue and chroma follow the
guide; lightness is 0.75 so each clears 7:1, and `--warm` drops to chroma 0.145
to stay inside sRGB. Nothing in any app toggles `.dark` yet.

Open accessibility item: the shared focus pattern is `focus-visible:border-ring`
plus a `ring-ring/50` halo. On a white page that halo tops out near 2.9:1 at any
teal, under the 3:1 minimum for a non-text indicator, so on primary-filled
controls (default `Button`, checked `Checkbox`) the border carries the cue at
about 1.8:1 against the fill. Fixing it properly means a ring offset in the
components, not a token value. Deferred with the rest of the component specs.

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
