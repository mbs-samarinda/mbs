# MBSS

The decisions behind this code live in a separate repository,
[`mbs-samarinda/knowledge`](https://github.com/mbs-samarinda/knowledge). Read
the relevant document before changing behaviour. If code and those documents
disagree, work out which is stale and fix that one in the same change.

`README.md` covers commands, ports and layout.

## Interface work comes first through the skills

Anything that renders — a screen, a component, copy, tokens, spacing — starts
by loading the skill that owns it. Do not write UI from memory.

| Doing | Load |
| --- | --- |
| Reviewing a whole screen or flow | `better-interface` |
| Layout, grouping, reading order | `better-layout` |
| Color, palettes, contrast | `better-colors` |
| Type scale, wrapping, truncation | `better-typography` |
| Radius, depth, icons, hit areas | `better-ui` |
| Labels, buttons, error text | `better-writing` |
| Keyboard, focus, names, contrast | `better-accessibility` |
| React and Next performance | `vercel-react-best-practices` |
| Component APIs and composition | `vercel-composition-patterns` |
| Adding or fixing a shadcn component | `shadcn` |
| Building any motion or transition | `animate` |
| Finding what should move and doesn't | `find-animation-opportunities` |
| Auditing motion across a codebase | `improve-animations` |
| Craft bar for polish and detail | `emil-design-eng` |

`better-interface` orchestrates the six `better-*` skills. Reach for it when
the scope is a screen; reach for one skill when the scope is one concern.

## Motion

Never write an animation from memory — `animate` first, every time. It decides
in the order that matters: whether it should animate at all, then purpose,
tool, properties, curve, duration, interruption, exit.

Once a piece of UI is built, run `find-animation-opportunities` on it. It is
read-only and rejects more than it proposes, which is the point: it names the
few moments worth animating and gives exact values, then `animate` builds them.

Two standing constraints, whatever a skill suggests:

- Nothing repaints continuously. No pulse, shimmer, blur loops or spinners —
  they peg the GPU on high-refresh displays.
- Motion respects `prefers-reduced-motion`. `better-accessibility` owns that
  rule.

## New UI: variants before implementation

For any non-trivial piece of UI, do not edit real components first. Three
variants get built behind a picker, and the choice is the user's.

**`variant`, `interface-review` and `review-animations` cannot be invoked by an
agent** — all three set `disable-model-invocation: true`. Ask the user to run
`/variant`, `/interface-review` or `/review-animations` themselves; do not try
to call them and do not hand-roll a substitute.

The sequence:

1. Say what the piece is, in one sentence.
2. Ask the user to run `/variant` on it.
3. They pick. Then build that one properly, delete the harness.
4. Run `find-animation-opportunities` on what was built; use `animate` for
   anything it proposes that the user wants.
5. Ask the user to run `/interface-review`, and `/review-animations` if motion
   was added.

Everything stays on this machine. Variants live in the app behind
`?variant=`, or in a local HTML file when no page can host them yet. Never
publish anything to claude.ai — no Artifacts, no hosted pages, no shared links.
Report a file path and let the user open it.

## Library guidance ships in node_modules

TanStack packages carry their own skills, versioned with the package:

```bash
pnpm dlx @tanstack/intent@latest list
pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core
```

Check that list before changing router, table or query code.

## House rules

- Build what the task asks for. No speculative abstractions, no options nobody
  requested, no scaffolding for later.
- A component with one consumer lives in that consumer's file, unexported. It
  moves to its own file the moment a second file needs it, and not before. A
  file per component makes every page a scavenger hunt when most of those
  components will only ever be used once.
- Short copy. Dense information. No decorative card or pill chrome.
- Run `/code-review` when a coding task is done.
- `pnpm gate` must pass before you call something finished.
