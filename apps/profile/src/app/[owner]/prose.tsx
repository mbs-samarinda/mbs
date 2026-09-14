import Markdown, { type Components } from "react-markdown";

/**
 * An editor's body copy, rendered.
 *
 * Strapi's `richtext` field is markdown, so an article body arrives with `**`
 * and `[]()` in it. `react-markdown` builds React nodes instead of HTML, which
 * is why nothing here sanitises: raw HTML is not enabled, so an editor account —
 * a trust boundary, however friendly — cannot put a script on a public page.
 * Do not add `rehype-raw`; that is the line it would cross.
 *
 * Every tag is mapped, because Tailwind's preflight strips heading sizes, list
 * markers and link colour. The alternative was `@tailwindcss/typography`, which
 * is a second styling system with its own scale beside the one `DESIGN.md`
 * defines.
 */
const COMPONENTS: Components = {
  h2: ({ children }) => <h2 className="mt-3 text-2xl font-bold text-balance">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2 text-xl font-bold text-balance">{children}</h3>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-2 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-2 pl-5">{children}</ol>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="flex flex-col gap-3 border-l-2 border-border pl-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-semibold text-primary underline underline-offset-4"
      // An editor's link can point anywhere. `noreferrer` is what keeps whatever
      // it opens from reaching back into this tab.
      {...(href?.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {children}
    </a>
  ),
};

export const Prose = ({ children }: { children: string }) => (
  // The measure is capped here rather than on each paragraph: 70ch is the rule
  // from DESIGN.md, and a heading inside the body has to obey it too.
  <div className="flex max-w-[70ch] flex-col gap-5 text-base leading-relaxed text-pretty">
    <Markdown components={COMPONENTS}>{children}</Markdown>
  </div>
);
