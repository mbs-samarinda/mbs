import type { ReactNode } from "react";

import { BrandMark } from "./brand-mark.tsx";

/** A whole page with one message and the way out of it. */
function StatusPage({
  sub,
  title,
  body,
  actions,
}: {
  sub: string;
  title: string;
  body: string;
  actions: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-10 px-[min(1.25rem,6vw)] py-6">
      <BrandMark sub={sub} />
      <main className="my-auto grid grid-cols-1 gap-6 pb-16">
        <div className="grid gap-2">
          <h1 tabIndex={-1} className="text-2xl font-semibold text-balance outline-none">
            {title}
          </h1>
          <p className="text-pretty wrap-anywhere text-muted-foreground">{body}</p>
        </div>
        <div className="flex flex-wrap gap-3">{actions}</div>
      </main>
    </div>
  );
}

export { StatusPage };
