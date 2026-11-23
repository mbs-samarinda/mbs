import { safeReturnTarget } from "@mbs/api-client/return-target";
import { BrandMark } from "@mbs/ui/components/brand-mark";
import { ThemeSelect } from "@mbs/ui/components/theme-select";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { accountQuery } from "../account.ts";
import { APP_NAME } from "../app-name.ts";
import smaArch from "../assets/sma-arch.avif";
import smaBand from "../assets/sma-band.avif";
import smkArch from "../assets/smk-arch.avif";
import smkBand from "../assets/smk-band.avif";
import smpArch from "../assets/smp-arch.avif";
import smpBand from "../assets/smp-band.avif";

type SignInSearch = { lanjut?: string | undefined; error?: string | undefined };

export const Route = createFileRoute("/masuk")({
  // Both keys are always set. The router lays this over the raw search, so a key
  // left out would let a refused value through.
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    lanjut: safeReturnTarget(search.lanjut, { signInPath: "/masuk" }),
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  head: () => ({ meta: [{ title: "Masuk · Pendaftaran Madina Boarding School" }] }),
  component: SignInLayout,
});

function SignInLayout() {
  const { lanjut = "/" } = Route.useSearch();
  const router = useRouter();
  const account = useQuery({ ...accountQuery, refetchOnWindowFocus: "always" });
  const signedIn = Boolean(account.data);

  // The one way out of these screens, for a code, for a visit that was already
  // signed in, and for a sign-in finished in another tab.
  useEffect(() => {
    if (signedIn) router.history.replace(lanjut);
  }, [signedIn, lanjut, router]);

  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-2">
      <Schools />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-[min(1.25rem,6vw)] py-6 lg:px-8 lg:py-10">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <BrandMark sub={APP_NAME} />
          <ThemeSelect size="touch" className="-mr-[min(0.75rem,6vw)] ml-auto" />
        </header>
        <main className="grid grid-cols-1 gap-6 pt-8 pb-10 lg:my-auto lg:py-8">
          <Outlet />
        </main>
        <footer className="mt-auto lg:mt-0">
          <p className="text-xs text-pretty text-muted-foreground">
            Diselenggarakan oleh Yapendis Nurul Haq Samarinda
          </p>
        </footer>
      </div>
    </div>
  );
}

const SCHOOLS = [
  { band: smpBand, arch: smpArch },
  { band: smkBand, arch: smkArch },
  { band: smaBand, arch: smaArch },
];

/**
 * The three buildings, the same size: bands above the form on a small screen,
 * arches beside it on a big one. `<picture>` so a phone never fetches an arch.
 * The sizes are the viewport's, not rem, so bigger text leaves the form its room.
 */
function Schools() {
  return (
    <div className="lg:bg-surface-brand flex h-[min(38vw,30dvh)] shrink-0 gap-0.5 lg:sticky lg:top-0 lg:h-dvh lg:items-end lg:gap-[1vw] lg:px-[1.75vw]">
      {SCHOOLS.map(({ band, arch }) => (
        <picture
          key={band}
          className="h-full min-w-0 flex-1 lg:aspect-5/12 lg:h-auto lg:max-h-[86dvh]"
        >
          <source media="(width >= 64rem)" srcSet={arch} width={452} height={1086} />
          <img
            src={band}
            alt=""
            width={400}
            height={400}
            className="bg-surface-brand size-full object-cover outline-1 -outline-offset-1 outline-black/10 lg:rounded-t-full dark:outline-white/12"
          />
        </picture>
      ))}
    </div>
  );
}
