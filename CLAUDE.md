# MBSS

The decisions behind this code live in
[`mbs-samarinda/knowledge`](https://github.com/mbs-samarinda/knowledge),
usually checked out next to this repository. Read the relevant document before
changing behaviour. If code and those documents disagree, work out which is
stale and fix that one in the same change.

`README.md` covers commands, ports and layout. Before any interface work, read
`../knowledge/docs/brand/brand-guide.md`: skills say how to think about a screen,
the guide says which colors, type, depth and density are approved. Token values
live in `packages/ui/src/styles/globals.css` and
`apps/profile/src/app/globals.css`.

## How work runs

Every task runs under pstack's `poteto-mode`: it picks the playbook, and its
principles decide scope. This file only adds what is specific to this repo.

- Done means `pnpm gate` passes and the change was seen working in the running
  app, not just compiled.
- Before changing router, table or query code, check the TanStack skills that
  ship in `node_modules`:
  `pnpm dlx @tanstack/intent@latest list`, then
  `pnpm dlx @tanstack/intent@latest load <package>#<skill>`.
- Everything stays on this machine. Never publish to claude.ai: no
  Artifacts, hosted pages or shared links. Report a file path instead.
- A component with one consumer lives in that consumer's file, unexported. It
  gets its own file when a second file needs it, not before.

## Interface work

Load the skill that owns a concern before writing it. Do not write UI from
memory.

| Doing                                                         | Load                               |
| ------------------------------------------------------------- | ---------------------------------- |
| A whole screen or flow                                        | `interfaces:better-interface`      |
| One concern: layout, color, type, polish, copy, accessibility | the matching `interfaces:better-*` |
| Adding or fixing a shadcn component                           | `shadcn`                           |
| React and Next performance                                    | `vercel-react-best-practices`      |
| Component APIs and composition                                | `vercel-composition-patterns`      |
| Any motion                                                    | `animate`                          |

New non-trivial UI starts as mocks through the `mock` skill, and the user
picks one. Once it is built, run `find-animation-opportunities` on it. Then
ask the user to run `/interface-review`, and `/review-animations` if motion was
added. An agent cannot invoke those two.

Two motion rules hold whatever a skill suggests:

- Nothing repaints continuously. No pulse, shimmer, blur loops or spinners.
  They peg the GPU on high-refresh displays.
- Motion respects `prefers-reduced-motion`.
