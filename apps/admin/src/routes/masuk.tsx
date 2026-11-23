import { AuthError, googleSignInUrl } from "@mbs/api-client/auth";
import { UnreachableError } from "@mbs/api-client/http";
import { safeReturnTarget } from "@mbs/api-client/return-target";
import { Alert } from "@mbs/ui/components/alert";
import { BrandMark } from "@mbs/ui/components/brand-mark";
import { Button } from "@mbs/ui/components/button";
import { GoogleButton } from "@mbs/ui/components/google-button";
import { ThemeSelect } from "@mbs/ui/components/theme-select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { cn } from "cn";
import { useEffect } from "react";

import { APP_NAME } from "../app-name.ts";
import { visitorQuery } from "../staff.ts";

type SignInSearch = { lanjut?: string | undefined; error?: string | undefined };

export const Route = createFileRoute("/masuk")({
  // Both keys are always set. The router lays this over the raw search, so a key
  // left out would let a refused value through.
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    lanjut: safeReturnTarget(search.lanjut, { signInPath: "/masuk" }),
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  head: () => ({ meta: [{ title: "Masuk · Panitia PPDB" }] }),
  component: SignIn,
});

function SignIn() {
  const { lanjut = "/", error } = Route.useSearch();
  const router = useRouter();
  const visitor = useQuery(visitorQuery);
  const signedIn = visitor.data !== undefined && visitor.data.kind !== "signed-out";

  useEffect(() => {
    if (signedIn) router.history.replace(lanjut);
  }, [signedIn, lanjut, router]);

  const google = useMutation({
    mutationFn: () =>
      googleSignInUrl({
        returnTo: lanjut,
        errorTo: lanjut === "/" ? "/masuk" : `/masuk?lanjut=${encodeURIComponent(lanjut)}`,
      }),
    onSuccess: (url) => location.assign(url),
  });
  const { reset } = google;

  // The button waits until the browser leaves. Coming back restores this page as
  // it was left, with the button still waiting.
  useEffect(() => {
    const onReturn = (event: PageTransitionEvent) => event.persisted && reset();
    addEventListener("pageshow", onReturn);
    return () => removeEventListener("pageshow", onReturn);
  }, [reset]);

  const refused = error === "account_not_approved";
  const busy = google.isPending || google.isSuccess;
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <Arches />
      <div className="mx-auto flex w-full max-w-md flex-col px-[min(1.25rem,6vw)] py-8 lg:px-8">
        <header>
          <BrandMark sub={APP_NAME} />
        </header>
        <main className="my-auto grid gap-5 py-8">
          <div className="grid gap-1.5">
            <h1 tabIndex={-1} className="text-xl font-semibold outline-none">
              Masuk
            </h1>
            <p className="text-sm text-pretty text-muted-foreground">
              Pakai akun Google yang sudah didaftarkan administrator.
            </p>
          </div>
          {google.error ? (
            <Alert>{explain(google.error)}</Alert>
          ) : visitor.error instanceof UnreachableError ? (
            <Alert>
              Server tidak bisa dihubungi. Periksa koneksi internet kamu.
              <Button
                variant="link"
                className="justify-self-start px-0 text-destructive underline"
                onClick={() => void visitor.refetch()}
              >
                Coba lagi
              </Button>
            </Alert>
          ) : refused ? (
            <Alert>
              Akun Google itu belum punya akses. Pilih akun lain, atau minta administrator
              mendaftarkan email kamu.
            </Alert>
          ) : error ? (
            <Alert>Masuk dengan Google belum berhasil. Coba lagi.</Alert>
          ) : null}
          <GoogleButton
            size="lg"
            disabled={busy}
            focusableWhenDisabled
            onClick={() => google.mutate()}
          >
            {busy ? "Membuka Google…" : refused ? "Pilih akun Google lain" : "Masuk dengan Google"}
          </GoogleButton>
        </main>
        <footer>
          <ThemeSelect size="default" />
        </footer>
      </div>
    </div>
  );
}

function explain(error: Error) {
  if (error instanceof UnreachableError) {
    return "Server tidak bisa dihubungi. Periksa koneksi internet kamu, lalu coba lagi.";
  }
  if (error instanceof AuthError && error.status === 429) {
    const wait = error.retryAfterSeconds;
    return `Terlalu banyak percobaan. Tunggu ${wait === null ? "1 menit" : `${wait} detik`}, lalu coba lagi.`;
  }
  return "Ada gangguan di sistem kami. Coba lagi sebentar lagi.";
}

/** Foreground mixed into the page, in percent: neutral in both modes from one list. */
const TONES = [
  "bg-[color-mix(in_oklch,var(--foreground)_3%,var(--background))]",
  "bg-[color-mix(in_oklch,var(--foreground)_5%,var(--background))]",
  "bg-[color-mix(in_oklch,var(--foreground)_7%,var(--background))]",
  "bg-[color-mix(in_oklch,var(--foreground)_9%,var(--background))]",
  "bg-[color-mix(in_oklch,var(--foreground)_12%,var(--background))]",
] as const;

// Harbor Teal, in both modes.
const ACCENT = "bg-[oklch(0.499_0.086_219.2)]";

const FACES = {
  up: ["rounded-t-full", "inset-x-1/4 top-1/4 bottom-0"],
  right: ["rounded-r-full", "inset-y-1/4 left-0 right-1/4"],
  down: ["rounded-b-full", "inset-x-1/4 top-0 bottom-1/4"],
  left: ["rounded-l-full", "inset-y-1/4 right-0 left-1/4"],
} as const;

type Cell = [face: keyof typeof FACES, ground: string, outer: string, inner: string];
const [a, b, c, d, e] = TONES;
const CELLS: Cell[] = [
  ["up", d, b, a],
  ["down", a, d, c],
  ["up", b, e, c],
  ["right", c, e, b],
  ["up", e, d, a],
  ["left", a, b, d],
  ["down", b, a, d],
  ["up", d, a, ACCENT],
  ["right", e, c, b],
  ["up", a, d, e],
  ["left", d, c, e],
  ["up", c, d, a],
];

/**
 * Plain round arches as a flat tile pattern. Boxes, not one SVG: the browser puts
 * a box's edges on whole pixels, so no hairline of the ground shows between two
 * tiles at any zoom. The pattern covers the panel and hangs over two sides.
 */
function Arches() {
  return (
    <div aria-hidden className="@container-size sticky top-0 hidden h-dvh overflow-hidden lg:block">
      <div className="absolute top-1/2 left-1/2 grid aspect-3/4 w-[max(100cqw,75cqh)] -translate-1/2 grid-cols-3 grid-rows-4">
        {CELLS.map(([face, ground, outer, inner], index) => {
          const [round, inset] = FACES[face];
          return (
            // oxlint-disable-next-line react/no-array-index-key
            <div key={index} className={cn("relative", ground)}>
              <div className={cn("absolute inset-0", round, outer)} />
              <div className={cn("absolute", inset, round, inner)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
