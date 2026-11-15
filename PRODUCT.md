# Product

<!-- impeccable:product-schema 1 -->

Product truth for this repository. The decisions behind it live in
[`mbs-samarinda/knowledge`](https://github.com/mbs-samarinda/knowledge),
usually checked out alongside this repository. It is the authority; this file summarises what design work must preserve. If the two
disagree, fix the stale one.

## Platform

web

## Users

- **Prospective families.** Parents comparing schools, prospective students,
  current families after official information, and visitors from search. Mostly
  on mid-range Android phones and patchy mobile data. They browse a school's
  profile site before applying.
- **School content editors.** They keep their school's public content current in
  Strapi. A global content administrator also edits the umbrella.
- **Parents, guardians and the admission committee.** They are the users of PPDB
  (admission), which is being redesigned from zero. Who they are and what they
  do is decided in `docs/admission.md` in the knowledge repository, not here.

## Product Purpose

One connected digital system for the MBSS schools: a public presence for each
school, a CMS to keep it current, and an admission system that is being
redesigned.

Success for what is built:

- A visitor understands a school and finds admission without asking anyone.
- An editor keeps content current without affecting another owner or admission.
- No page shows a stale admission fact: open or closed, dates and fees are read
  live, never typed by an editor.

## Positioning

MBSS is one organisation with a fixed set of schools, not a platform schools
sign up for. The school list is a compile-time constant
(`packages/school-config`). Anything an administrator changes lives in
PostgreSQL. Editable content lives in Strapi.

Explicit non-goals: not a website builder, not a generic form builder, not a
school ERP, not a learning system, not a marketplace for independent schools.

## Operating Context

| App | Job | State |
| --- | --- | --- |
| `apps/profile` (Next.js) | Public sites: umbrella at the apex, one school per subdomain | built |
| `apps/cms` (Strapi) | Profile content only, own database | built |
| `apps/api` (Fastify + oRPC) | Admission data; the profile reads admission facts from it | partial, redesign |
| `apps/admission` (Vite) | Parent admission | empty scaffold, redesign |
| `apps/admission-admin` (Vite) | Committee workspace | empty scaffold, redesign |

Three schools: SMP Islam Terpadu Madina, SMK Terpadu Madina, SMA Madina Citra
Insani. Public content belongs to one of four **owners**: `mbs`, the Madina
Boarding School umbrella at the apex, and the three schools. The hostname
resolves the owner, and an unknown hostname fails closed.

The profile sites, the CMS and their decisions are in
`docs/profile-sites.md` and `docs/cms.md` in the knowledge repository. PPDB is
in `docs/admission.md`. Read those; this file does not repeat them.

## Capabilities and Constraints

- The API decides. Front ends render state and never own it. Apps never import
  each other's source; they talk over HTTP.
- The profile reads `public.admission.getCurrentCycle` live and never caches it.
  A failed read shows "unavailable" and never guesses. This is the one contract
  between the live profile and the PPDB redesign.
- The profile never collects applications, authenticates parents, takes payment
  or reads private records.
- Editors compose approved blocks. They never set a palette, write page code or
  maintain a second admission date.
- All public copy is Bahasa Indonesia. No Arabic script anywhere: no Arabic
  typeface, no RTL layout, no Arabic content fields.
- Two control densities share one component set: 44px touch targets on public
  and parent-facing surfaces, the compact 24 to 36px scale for staff and CMS work.
- `packages/api-contract` holds the contract and Zod schemas. `packages/db`
  holds the Drizzle schema and migrations, used by the API alone. `packages/ui`
  holds the shared shadcn/ui components on Base UI and the design tokens.

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
a surface needs them. Of the four approved status pairs only alarm ships, as
`--destructive` and `--destructive-tint`; success, warning and information are
approved values with no surface yet, and `Badge` has no variant for them — its
variants are `default`, `secondary`, `destructive`, `outline`, `ghost` and
`link`. One elevation token ships: `--shadow-overlay`.

`--sidebar-*` and `--chart-*` are gone. Nothing consumed either family, they
still held pre-approval values, and `shadcn add sidebar` or `chart` brings back
a correct set the day something needs one — which is cheaper than inventing a
dark sidebar ramp nobody approved for a component nobody installed.

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
404 is the part it cannot cover: Next's not-found boundary sits above the root
layout, so a `not-found.tsx` in the segment never claims an unclaimed path, and
neither does one beside a `[...rest]` catch-all calling `notFound()` — both
were built and measured. `app/global-not-found.tsx` (the `globalNotFound`
experiment) answers those paths instead. It is a document of its own, outside
the tree, so it imports the stylesheet and sets `data-owner` itself, reading
the owner from the Host header because nothing above the segment has `params`.
That header read makes the one `/_not-found` route dynamic (`instant = false`);
the owner pages keep their own layout and stay `○ (Static)`.

Two roles the shared layer has no token for arrive with the blocks:
`--accent-brand` (the Rare Orange rule; `--accent` is already the neutral hover
fill) and `--surface-brand` for a tinted band. Both are registered in a
`@theme inline` block beside them, so `bg-accent-brand` and `bg-surface-brand`
resolve — without the alias the class compiles to nothing and the element comes
out transparent with no build error.

Each owner's `<title>` and description are its own, from `generateMetadata` in
the same layout that already resolved the owner, so the pages stay static. The
description is a placeholder until the CMS owns SEO defaults.

An owner is not a school. The umbrella has a home page and a palette but no
other pages, no admission cycle, no staff scope and no row in the schools table, so `OWNERS`
lives in `apps/profile` and `SCHOOLS` stays the three-school list the admission
side means by the word. `schoolFromHostname` is gone; owner resolution replaced
its only caller, and an unknown host resolves to nobody rather than falling
back to the umbrella. `localhost` and `smk.localhost` resolve the same way as
the real hosts, so the app is runnable locally, and `PROFILE_APEX` swaps the
domain for a staging deploy so a preview resolves owners too. A `www.` host
answers a 308 to the bare host, so each page has one URL; metadata resolves
against that host via `metadataBase`.

Verified against the running build: `/` on `sma.mbss.sch.id` answers
`<html lang="id" data-owner="sma">` with the stylesheet and that school's
colour, `/about` answers 404 with the same document shell and that school's
colour, `/favicon.ico` answers
404 rather than the umbrella's page, `localhost` resolves to the umbrella, and
an unknown host is refused before any page renders.

The hostname-to-owner rewrite lives in `apps/profile/src/proxy.ts`. It was
`middleware.ts` until Next 16 deprecated that convention; the codemod renamed it
and the exported function.

The alarm pair now ships as `--destructive` plus `--destructive-tint`, the
guide's approved ink on its approved tint. Before this it was shadcn's stock red
with the tint faked by alpha, which measured 3.99:1 resting and 3.32:1 on hover
in the destructive button and badge. `packages/ui/test/contrast.test.ts` asserts
the ratio so the value cannot drift back.

`--muted-foreground` was shadcn's `#737373`, which measures 4.35:1 on a tinted
band — under the floor for normal text, on a design full of tinted bands. It is
now `#6e6e6e`: 4.68:1 on the tint, 5.10:1 on white.

Settled on 13 September 2026: the neutral ramp is the gray one already shipping,
in both modes — the warm-neutral direction was withdrawn, since the dark ramp is
neutral gray and a warm light ramp beside it would be two systems. The chart ramp
was withdrawn too; nothing charts anything. One thing for whoever approves them: Ember Orange at hue 42 would sit 13.5 degrees from the
alarm ink at 28.5, so error and warm accent would read as one family, and the
guide says orange is never the error color. Nothing ships that clash today —
Ember Orange has no token yet — but it lands the moment one is added. Dark mode is approved for the public
profile sites as of 12 September 2026: a neutral ramp, a lighter variant of each
school palette that carries dark text, and inverted status pairs, all recorded in
the brand guide. It is a token swap, not a second design. The existing `.dark`
block in `globals.css` predated that approval and carried derived values; it now
carries the ramp. Page and card share `#141414`, so separation comes from the
hairline rather than a lighter card, and the primary label follows paper, which
is white on a light page and near-black on a dark one. Owner primaries are not
in there — they arrive with the per-owner blocks. Admission, committee and CMS
get it too: dark mode was extended to every MBSS application on 13 September 2026.
The profile sites now drive it, and are the pattern the other three follow: the
operating system decides on a first visit, a three-state control (Sistem /
Terang / Gelap) overrides it, and the choice is stored in a cookie on the parent
domain rather than in `localStorage`. That last part is what the profile needed
and the other apps will not: four owners are four origins, `localStorage` is per
origin, and the school switcher's whole job is moving between those hosts, so a
per-origin store would drop the preference at every switch. An inline script
applies the class and `color-scheme` before the first paint, because having the
server read the cookie would make every page dynamic.

Closed: the focus pattern. It is one rule in the base layer —
`:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px }` — and
every per-component copy is deleted. Eight components each carried their own,
built on `ring-offset`, whose gap is a solid band of `--background`: it only
vanished on the page ground and read as a mismatched line in a dialog footer or
a table header, and the calendar could not use it at all because its day cells
abut and the band cut through a selected range. An outline's offset is
transparent, so one rule covers every surface and the calendar needs no
exception. The gap is still what makes the ring legible on a filled control:
the ring never has to out-contrast the fill, because the page sits between
them.

## Evidence on Hand

- Knowledge repository: one file per topic under `docs/`, indexed in its README,
  plus the brand guide and reference-asset inventory.
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
- **Precise feedback.** Name the exact field and say what is wrong. A bare
  "invalid" helps nobody.
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
