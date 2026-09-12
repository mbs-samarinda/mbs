---
name: MBSS
description: One admission and profile system for three Madina schools — calm for parents, dense for the committee.
colors:
  harbor-teal: "oklch(0.499 0.086 219.2)"
  harbor-teal-hover: "oklch(0.42 0.086 219.2)"
  madina-teal: "oklch(0.654 0.112 184.1)"
  ember-orange: "oklch(0.674 0.19 42)"
  shallow-teal: "oklch(0.585 0.104 221.3)"
  ink: "oklch(0.145 0 0)"
  paper: "oklch(1 0 0)"
  quiet-surface: "oklch(0.97 0 0)"
  muted-ink: "oklch(0.538 0 0)"
  hairline: "oklch(0.922 0 0)"
  alarm-red: "oklch(0.509 0.209 28.5)"
  alarm-tint: "oklch(0.971 0.013 17.4)"
  alarm-tint-hover: "oklch(0.935 0.024 17.4)"
  focus-teal: "oklch(0.35 0.063 219.2)"
  dark-paper: "oklch(0.191 0 0)"
  dark-quiet: "oklch(0.235 0 0)"
  dark-ink: "oklch(0.961 0 0)"
  dark-muted-ink: "oklch(0.741 0 0)"
  dark-hairline: "oklch(0.341 0 0)"
  dark-primary: "oklch(0.78 0.086 219)"
  dark-primary-hover: "oklch(0.7 0.086 219.7)"
  dark-focus-ring: "oklch(0.921 0.058 218.2)"
  dark-alarm-red: "oklch(0.72 0.161 25)"
  dark-alarm-tint: "oklch(0.26 0.059 25.1)"
  smp-green: "oklch(0.469 0.104 154.6)"
  smp-green-hover: "oklch(0.393 0.090 152.5)"
  smp-gold: "oklch(0.728 0.138 89.7)"
  smk-blue: "oklch(0.514 0.166 258.1)"
  smk-blue-hover: "oklch(0.442 0.141 258.0)"
  smk-orange: "oklch(0.683 0.185 44.0)"
  sma-maroon: "oklch(0.490 0.181 21.8)"
  sma-maroon-hover: "oklch(0.419 0.154 21.6)"
  sma-gold: "oklch(0.800 0.153 86.9)"
typography:
  display:
    fontFamily: "Plus Jakarta Sans Variable, sans-serif"
    fontWeight: 800
  headline:
    fontFamily: "Plus Jakarta Sans Variable, sans-serif"
    fontWeight: 700
  title:
    fontFamily: "Plus Jakarta Sans Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1
  body:
    fontFamily: "Plus Jakarta Sans Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Plus Jakarta Sans Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  "2xl": "18px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.harbor-teal}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.harbor-teal-hover}"
    textColor: "{colors.paper}"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
  button-destructive:
    backgroundColor: "{colors.alarm-tint}"
    textColor: "{colors.alarm-red}"
    rounded: "{rounded.lg}"
    height: "32px"
  input-default:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    height: "32px"
  dialog-content:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "16px"
---

# Design System: MBSS

## Overview

**Creative North Star: "The Guided Registrar"**

A registrar is the person at the desk who has done this a thousand times and is
still glad you came. They tell you where you are, what is missing, and what
happens next — without ceremony, without making you feel slow, and without
pretending a problem is smaller than it is. Every screen in this system is that
person. A parent filling a form on a phone at eleven at night and a committee
member working a queue on a laptop are being served by the same desk, in
different registers.

The system is Islamic and principled, warm and reassuring, capable and
disciplined, aspirational, contemporary, local and human. It is not a
technology company. It reads as an established school that has organised
itself well: teal carries hierarchy, orange appears rarely and deliberately,
surfaces stay flat and honest, and typography does the structural work. Nothing
decorative earns its place if it competes with a status a parent needs to read.

The registers differ by application, not the system. Parent admission is calm
and forgiving: generous space, one clear action per screen, progress always
visible. Committee administration is operational: dense, flat, status-led, no
promotional styling. Public profiles are expressive: school color, real
photography, editorial composition. Campaign material is energetic. The family
resemblance comes from typography, spacing, voice and color logic — never from
forcing the same layout on all four.

**Key Characteristics:**

- Warm authority: never bureaucratic, never salesy
- Flat surfaces, hairline borders, tonal fills — depth only where something floats
- Teal for hierarchy, orange for rare warmth, neutral for everything else
- One typeface, working across welcoming public copy and compact operational tables
- Status is always legible: never color alone, never an icon alone
- Bahasa Indonesia, Latin script only — no Arabic-script UI anywhere

## Colors

A restrained neutral field with two teals doing the structural work and a single
warm accent held in reserve.

### Primary
- **Harbor Teal** (`#126e84`): every solid interactive control — primary buttons,
  active navigation, links, checked controls. It is primary because it is the
  only brand color that carries white text at normal size (5.85:1). Hover
  darkens to Harbor Teal Deep rather than fading.
- **Madina Teal** (`#18a698`): the recognition color. Large brand areas,
  illustration, selected highlights, marks. It takes dark text (3.02:1 against
  white), so it is never a button surface and never carries white body copy.
  *No token ships for this yet — nothing consumes it.*

### Secondary
- **Shallow Teal** (`#1389a7`): secondary accents, charts, selected large
  elements. White text only at large sizes (4.07:1). *No token ships for this
  yet — it has no consumer.*

### Tertiary
- **Ember Orange** (`#f26420`): restrained emphasis and campaign warmth. Small
  moments, never a surface a workflow depends on. *No token ships for this yet
  — nothing consumes it.*

### Neutral
- **Ink** (`oklch(0.145 0 0)`): body text, headings, and the foreground on every
  brand fill.
- **Paper** (`oklch(1 0 0)`): page and card ground.
- **Quiet Surface** (`oklch(0.97 0 0)`): muted fills, secondary buttons, table
  headers, dialog footers.
- **Muted Ink** (`#6e6e6e`): supporting copy, placeholders, column labels. Was
  shadcn's `#737373`, which measures 4.35:1 on a tinted band — under the floor for
  normal text, and tinted bands are everywhere in this design. This holds 4.68:1
  on the tint and 5.10:1 on white.
- **Hairline** (`oklch(0.922 0 0)`): borders, dividers, input strokes. This is
  the system's main separation device.
- **Alarm Red** (`#c10007`): validation and destructive actions only, always as
  ink on **Alarm Tint** (`#fef2f2`) — 5.87:1. Both ship. The error red `#e7000b`
  is not this color: it measures 4.36:1 on the tint and cannot carry a label
  there. The tint is a token, not `bg-destructive/10`, for the reason
  `--primary-hover` exists — fading the ink with alpha to make a surface starves
  the text that surface carries, and that pattern measured 3.99:1 resting and
  3.32:1 on hover. **Alarm Tint Hover** (`oklch(0.935 0.024 17.4)`) is derived, not
  approved: the guide gives one tint per status, and a tinted control still needs
  somewhere to go on hover. It deepens on the tint's own hue rather than the
  ink's, because rotating toward 28.5 walks into the warm family and nothing that
  reads as orange may read as error. It holds 5.26:1.
- **Focus Teal** (`oklch(0.35 0.063 219.2)`): focus rings only. Deliberately
  darker than Harbor Teal so a focus ring stays visible on a teal-filled
  control. Chroma is capped at the sRGB limit for that lightness and hue —
  anything higher renders as a browser-chosen approximation.

### School palettes

Approved 12 September 2026, one set per owner, applied only on that owner's own
public profile site. Four owners, not three: the umbrella has a palette too.

| Owner | Primary (action) | Hover | Accent | Surface tint | Focus ring | White on primary |
| --- | --- | --- | --- | --- | --- | --- |
| MBS umbrella | `#126e84` | `#00576d` | `#f26420` | `#e7f0f3` | `#014251` | 5.85:1 |
| SMP IT Madina | `#1A6B3F` | `#14532D` | `#C9A227` | `#E8F2EC` | `#0B3A22` | 6.52:1 |
| SMK Terpadu Madina | `#1D63C4` | `#17509F` | `#F26A21` | `#E8F0FB` | `#0E3268` | 5.78:1 |
| SMA MCI | `#B01C2E` | `#8E1524` | `#E8B62C` | `#FBECEE` | `#650F1A` | 6.88:1 |

Every primary carries white text at normal size, so it takes over every solid
interactive control on its own site. No accent carries white text, which is what
stops an accent becoming a button surface; accents take dark text only and follow
the Rare Orange Rule. Each focus ring is darker than its own primary so the ring
survives on a filled control.

SMA's maroon replaced the guide's earlier blue / blue-violet direction on the
school's decision; the guide was amended the same day. Its focus ring sits at hue
20.5 and Alarm Red at 28.5 — on that site keep the ring clearly darker and never
let hue alone separate focus from validation.

### Dark mode

Approved 12 September 2026 for the public profile sites. Token values change; the
components, type scale, spacing and layout do not.

| Role | Light | Dark |
| --- | --- | --- |
| Page and card | `#ffffff` | `#141414` |
| Tinted band | `#f5f5f5` | `#1E1E1E` |
| Body text | `#0a0a0a` | `#F2F2F2` (16.5:1) |
| Supporting text | `#6e6e6e` | `#ABABAB` (8.0:1) |
| Hairline | `#e5e5e5` | `#383838` |

School primaries keep their hue and chroma and rise into the 0.78 lightness band —
SMP `#7fcb9a`, SMK `#8ab9ff`, SMA `#ff9592`, umbrella `#74c5dd` — and carry dark
text at 8.7:1 or better. Status pairs invert to light ink on a dark tint: success
`#6ad895` on `#0c2b19`, warning `#fac053` on `#331f05`, information `#76cce5` on
`#002933`, alarm `#f97770` on `#3c1715`.

The focus ring is lighter than its primary here, the mirror of light mode, for the
same reason: it must survive on a filled control. Photographs keep their outline in
both modes and only its color flips. No pure black, and supporting text never
lighter than `#ABABAB`. Dark mode follows the visitor's system preference with an
explicit override; it is never forced.

**Shipped.** `packages/ui` now carries this ramp: page and card share `#141414`,
so separation comes from the hairline rather than a lighter card. The primary
label is `--primary-foreground` set to paper, which is white on a light page and
near-black on a dark one — the inversion falls out of the token name, and no
`on-primary` token exists. Owner primaries are not here; they arrive as one
custom-property block per owner in `apps/profile`, which now ships: four
blocks light, four dark, keyed off a `data-owner` attribute on `<html>`, plus
`--accent-brand` and `--surface-brand` for the two roles the shared layer has
no token for.

Two groups in that block are **not** reconciled and are marked so in the file:
the chart ramp, which is deferred, and the `--sidebar-*` family, which still
holds pre-approval values — the sidebar ground sits about 1.09:1 against
`#141414`, its border is translucent where the hairline is now opaque, and its
primary is shadcn's violet at hue 264. Nothing consumes either group, so nothing
renders wrong today. Dialogs are the other thing to know: they carry
`bg-popover shadow-overlay` with no border, so on a shared ground "borders carry
structure" does not yet apply to them.

**Unresolved, and not to be invented:** the warm-neutral family the guide calls
for (the neutrals above are a gray ramp, not a warm one), the semantic success /
warning / information tokens, and the chart ramp.

### Named Rules

**The Rare Orange Rule.** Ember Orange is emphasis, never state. It is never the
error color, never a status fill, never a default button. If a screen has more
than one orange element, one of them is wrong.

**The Two-Teal Rule.** Harbor Teal acts; Madina Teal identifies. If it can be
clicked, it is Harbor. If it is the brand being recognised, it is Madina. Never
swap them to break up a monotonous screen.

**The Never-Color-Alone Rule.** Every status carries a word. Color, icon and
position are reinforcement. A parent who cannot distinguish teal from gray must
still know their application was accepted.

**The School-Color Containment Rule.** A school's primary colors its own public
profile. It never recolors payment, validation, or workflow state, and it never
enters the shared admission or committee shell beyond identity context.

## Typography

**Display Font:** Plus Jakarta Sans Variable (fallback `sans-serif`)
**Body Font:** Plus Jakarta Sans Variable — the same family
**Label/Mono Font:** none; tabular numerals from the same family carry aligned
dates, fees and counts

**Character:** One humanist sans, weights 200–800, doing everything from a
welcoming school headline to a 14px table cell. It is friendly without being
soft and neutral enough to disappear inside dense operational work. A second
decorative family would break the family resemblance the four applications rely
on.

### Hierarchy
- **Display** (800, size and line-height *[to be resolved during
  implementation]* — no hero or campaign surface exists yet): campaign headlines
  and public hero statements only. Never inside a form.
- **Headline** (700, size and line-height *[to be resolved during
  implementation]*): public page and section headings.
- **Title** (500, 16px, 1): dialog titles, card headings, workspace section
  headings.
- **Body** (400, 14px, 1.5): all running copy and form values. Keep reading
  measure at 65–75ch on public and parent surfaces.
- **Label** (500, 14px, 1): form labels, buttons, navigation, column headers.

**Rendering:** `-webkit-font-smoothing: antialiased` on the root, once. macOS
renders this family heavier than intended without it.

**Wrapping:** `text-wrap: balance` on headings, `pretty` on descriptions.
Indonesian strings run long and wrap lopsidedly otherwise.

### Named Rules

**The One Family Rule.** Plus Jakarta Sans covers every register. No second
typeface, no decorative display face, no icon font. The `--font-heading` alias
exists and deliberately points at `--font-sans`; it is a naming seam, not an
invitation to introduce a display family.

**The No-Shouting Rule.** No uppercase paragraphs, no wide letter-spacing runs,
no weights below 400 for text a parent must read on a phone.

**The Latin-Only Rule.** Applications render no Arabic-script text: no Arabic
typeface, no RTL layout, no Arabic content fields. Calligraphy inside an
approved logo stays part of that fixed artwork and is never extracted as type or
decoration.

## Layout

Mobile-first for public profiles and parent admission; laptop-first for the
committee and CMS, while keeping read-only and urgent actions usable on a phone.

Spacing runs on Tailwind's 4px rhythm. Two densities share one component set,
differing by size prop rather than by a second library:

- **Committee and CMS** use the compact scale — 24px (`xs`), 28px (`sm`), 32px
  (default), 36px (`lg`). This is what lets a queue table stay dense without
  crowding. Staff work at a laptop with a pointer, where 24×24 is a real target.
- **Parent admission and public profiles** use `touch` (44px) for anything a
  visitor taps, with more space around it. The visitor is on a phone, one-handed,
  and the control has to be the target — nothing invisible extends it.

Every data-backed page handles the same states: loading, empty or no assigned
scope, content, validation failure, recoverable failure with retry, lost
authentication with a safe return, permission denied without leaking, not found,
and unexpected failure with a request reference. Entered form data survives a
recoverable error.

Dense tables become purpose-built compact lists on small screens. They are never
merely a compressed desktop table.

### Named Rules

**The Three Questions Rule.** Every screen answers, without the user
remembering another screen: where am I, what is the current state, what should I
do next.

**The URL-Owns-State Rule.** Anything that should survive a refresh or be shared
lives in the address: the selected application, the section, committee filters.
Never a hidden "active child" in the session.

## Elevation & Depth

Shadow carries depth; borders carry structure. A border that exists only to
suggest lift is replaced by a shadow. A border that separates a table row from
the next, marks a selected state, or draws a focus ring stays exactly where it
is — those are structure and state, not depth.

Two steps, and no more. Resting controls sit one step above the page. Surfaces
that genuinely float — dialogs, alert dialogs, select menus — sit at the overlay
step. Nothing else has a shadow, and nothing lifts on hover: hover changes
color.

Both shadows are layered and transparent, so they read correctly on a white page
and on a tinted one. The dialog additionally dims the page behind it with a
light scrim and a small backdrop blur, which remains the single sanctioned use
of backdrop-filter.

*This replaces the brand guide's flat-surfaces direction, approved by the brand
owner. The guide has been amended to match; see `docs/brand/brand-guide.md` in
the knowledge repository.*

### Shadow Vocabulary
- **raised** (`0 1px 2px oklch(0 0 0 / 0.05), 0 1px 3px oklch(0 0 0 / 0.08)`):
  resting controls — the default, outline and secondary buttons. Enough to lift
  them off the page, not enough to read as a card.
- **overlay** (`0 4px 8px -3px oklch(0 0 0 / 0.06), 0 14px 28px -10px oklch(0 0 0 / 0.2)`):
  dialogs, alert dialogs, select menus. Replaced the hairline ring these used.
- **scrim** (`background: rgb(0 0 0 / 0.10)` with `backdrop-filter: blur(4px)`):
  the ground behind a modal.

### Named Rules

**The Two-Step Rule.** There are exactly two elevations: raised and overlay.
A third step is a design change, not a component decision.

**The Depth-Is-Shadow Rule.** A border that only fakes depth is a shadow written
wrong. Borders stay for dividers, structure, selection and focus.

**The Nothing-Lifts-On-Hover Rule.** Hover changes color. Elevation describes
what a surface *is*, not what the pointer is doing.

## Shapes

Clean rectangles with modest, consistent rounding. The radius scale is
concentric from a single 10px root: 6px (sm), 8px (md), 10px (lg) for controls
and inputs, 14px (xl) for dialogs and larger containers, 18px (2xl) and above
for full-bleed panels. Small controls step their radius down proportionally so a
24px button does not look like a pill.

Borders are one hairline pixel and do real work — they are how surfaces
separate. Fills carry meaning; strokes carry structure.

Permitted motifs, always secondary to content: open-page angles drawn from the
book forms in the school logos, gentle architectural arches, simple campaign
framing lines.

### Named Rules

**The Nothing-Is-A-Pill Rule.** Fully rounded shapes are reserved for genuine
badges. Buttons, inputs and cards keep the radius scale.

**The No-Emblem-Watermark Rule.** Detailed school emblems are never enlarged as
background watermarks or fragmented into decoration.

## Components

### Buttons
- **Shape:** rounded rectangle (10px), stepping to 8px at the two smallest sizes
  and up to 14px at `touch`
- **Sizes:** 24 / 28 / 32 / 36 / 44px tall (`xs`, `sm`, default, `lg`,
  `touch`); icon-only variants are square at the same heights
- **Primary:** Harbor Teal fill, white label, 14px medium
- **Hover:** darkens to Harbor Teal Deep — a solid color change, not opacity
- **Focus:** a solid 2px Focus Teal ring, offset 2px from the control so it
  stays visible on a Harbor Teal fill. A 50% halo drawn against the fill
  measures 1.77:1 and cannot carry the indicator alone.
- **Active:** `scale(0.96)`. The only movement in the system.
- **Hit area:** the visible control is the target. An invisible overlay was
  tried and removed — it extended past the control and swallowed clicks meant
  for whatever sat under it.
- **Outline / Secondary / Ghost:** neutral surfaces, muted fill on hover
- **Destructive:** tinted red surface with red text — never a solid red slab
- **Link:** Harbor Teal with an underline on hover

### Cards / Containers
- **Corner Style:** 14px on dialogs and panels
- **Background:** Paper, with Quiet Surface for footers and headers
- **Shadow Strategy:** raised for resting controls, overlay for floating
  surfaces (see Elevation & Depth)
- **Border:** one hairline pixel
- **Internal Padding:** 16px

### Inputs / Fields
- **Style:** transparent fill, hairline border, 10px radius, 32px tall
- **Focus:** a solid 2px Focus Teal ring, offset 2px from the field
- **Error:** red border and a red halo, always with an associated message —
  never the border alone

Badge, textarea, input group and calendar had kept shadcn's 3px ring at 50%
opacity, which is the 1.77:1 halo the button rule above rejects. They now use the
same solid indicator. The gap is what does the work: the ring never needs contrast
against the fill it surrounds, because 2px of something else sits between them.

Two caveats on the mechanism, both real. `ring-offset` paints that gap as a solid
band of `--background`, so it only disappears when the control sits on the page
ground — in a dialog footer (`bg-muted/50`) or a table header the band reads as a
mismatched line. And the calendar cannot use it at all: day cells abut with no
gutter, so an opaque band cuts through a selected range and over its neighbours.
The calendar uses `outline` with `outline-offset`, whose gap is transparent.

That transparency is the better mechanism, and moving every control to a single
`:focus-visible` rule in the base layer would retire both caveats and delete the
per-component classes. It has not been done: it changes the focus treatment of
every app at once and wants its own change.
- **Disabled:** muted fill at reduced opacity, cursor blocked
- **Labels:** persistent, above the field, 14px medium. Never a placeholder
  standing in for a label.

### Tables
- **Header:** Quiet Surface, muted ink, 14px medium
- **Rows:** hairline dividers, muted hover fill, no zebra striping
- **Numerics:** tabular figures for dates, fees and counts
- **Small screens:** below `sm` the table is replaced by a stacked list — one
  card per row, fields as a label/value grid. Never a horizontal scroll.

### Dialogs
- **Content:** Paper, 14px radius, 16px padding, overlay shadow
- **Backdrop:** light scrim with a small blur
- **Motion:** 200ms fade and 95% scale in, 150ms out, on the system's
  `--ease-out`
- **Footer:** Quiet Surface band, buttons right-aligned on wide screens,
  stacked in reverse on narrow ones
- **Exit:** the dialog keeps its content until the animation finishes. Content
  driven by state that clears on close must retain the last value, or the text
  vanishes first and an empty box shrinks away.

### Navigation
- **Style:** 14px medium labels, no chrome; the active item is Harbor Teal
- **Context:** the current school and, in parent admission, the current child are
  always visible
- **Mobile:** primary actions stay reachable without hiding status

## Do's and Don'ts

### Do:
- **Do** put every status into words. Color is reinforcement, never the message.
- **Do** darken on hover (Harbor Teal Deep), never fade a brand fill with
  opacity — `bg-primary/80` drops white text to 3.89:1.
- **Do** keep Ember Orange rare and decorative-free.
- **Do** use tabular numerals for dates, fees and counts.
- **Do** grow the control when a target needs to be bigger. An invisible overlay
  extending past a control steals the clicks of whatever it covers — the
  checkbox is the one exception, because at 16px it falls under the 24×24
  baseline, and its neighbours are spaced to clear the overlay.
- **Don't** use the compact scale on a parent-facing surface. `touch` (44px) is
  the size there; the dense scale belongs to the committee and the CMS.
- **Do** match icon stroke to the weight of the text beside it — 1.75 next to
  medium (500) labels.
- **Do** end every error with a way out: a retry, a link, or both. A message
  with no action is a dead end.
- **Do** hold WCAG 2.2 AA in every state, and let accessibility beat exact color
  fidelity when the two conflict.
- **Do** respect `prefers-reduced-motion`: opacity survives, everything that
  travels or scales stops.
- **Do** keep committee density and parent calm as differences in spacing, not
  two component libraries.

### Don't:
- **Don't** ship an Arabic typeface, RTL layout, or Arabic-script content field.
- **Don't** use continuous motion — no shimmer, pulse, spinner or blur loop.
  Skeletons hold layout; they do not animate forever.
- **Don't** put white text on Madina Teal or Ember Orange.
- **Don't** invent the deferred tokens: warm neutrals, semantic colors, chart
  ramp.
- **Don't** sample a color from a compressed raster logo and call it official.
- **Don't** add gradients, glass, or decorative pill chrome. Shadows are the two
  tokens above and nothing else.
- **Don't** let a school's color escape its profile site into workflow state.
- **Don't** place three equal school logos in one header, or shorten an identity
  to just "Madina".
