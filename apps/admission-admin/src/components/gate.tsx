import { Button } from "@mbs/ui/components/button";

/**
 * The screens shown before anyone reaches the queue: sign-in and the two dead
 * ends behind it. A solid brand panel says which system this is, since staff
 * arrive here from an email or a bookmark rather than from inside the product.
 *
 * It carries the umbrella name and what the tool is for, never the brand
 * promise — the brand guide keeps that out of transactional staff screens.
 *
 * The panel is --primary, the one brand colour that carries white text at
 * normal size (5.85:1). Madina Teal would not: it measures 3.02:1.
 */
export function Gate({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  /** Every action here is a Google sign-in; only the wording differs. */
  onAction: () => void;
}) {
  return (
    <main className="grid min-h-dvh md:grid-cols-2">
      {/* Below 768px this becomes a band so the action still opens above the fold. */}
      <div className="flex flex-col justify-end bg-primary px-6 py-8 text-primary-foreground md:px-10 md:py-12">
        <p className="text-sm font-medium">Madina Boarding School</p>
        <p className="mt-1 max-w-xs text-lg leading-snug font-semibold text-balance md:mt-2 md:text-2xl">
          Ruang kerja panitia penerimaan murid baru.
        </p>
      </div>

      <div className="flex items-center justify-center px-6 py-12 md:py-16">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-semibold tracking-tight text-balance text-foreground">
            {title}
          </h1>
          <p className="mt-2 text-sm text-pretty text-muted-foreground">{body}</p>
          <Button size="lg" variant="outline" className="mt-6 w-full" onClick={onAction}>
            <GoogleMark />
            {actionLabel}
          </Button>
        </div>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false" className="size-4">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
