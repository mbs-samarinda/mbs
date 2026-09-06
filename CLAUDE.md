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

`better-interface` orchestrates the six `better-*` skills. Reach for it when
the scope is a screen; reach for one skill when the scope is one concern.

## New UI: variants before implementation

For any non-trivial piece of UI, do not edit real components first. Three
variants get built behind a picker, and the choice is the user's.

**`variant` and `interface-review` cannot be invoked by an agent** — both set
`disable-model-invocation: true`. Ask the user to run `/variant` or
`/interface-review` themselves; do not try to call them and do not hand-roll a
substitute.

The sequence:

1. Say what the piece is, in one sentence.
2. Ask the user to run `/variant` on it.
3. They pick. Then build that one properly, delete the harness.
4. Ask the user to run `/interface-review` on the change.

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
- Short copy. Dense information. No decorative card or pill chrome.
- No CSS animation that repaints continuously — pulse, shimmer, blur, spinners.
- Run `/code-review` when a coding task is done.
- `pnpm gate` must pass before you call something finished.
