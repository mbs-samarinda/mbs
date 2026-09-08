import { Button } from "@mbs/ui/components/button";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet, useRouter } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold text-balance">Halaman tidak ditemukan</h1>
      <Link to="/" className="mt-4 inline-block text-sm underline">
        Kembali ke beranda
      </Link>
    </main>
  ),
  // An error screen with no way out is a dead end. The link is the escape when
  // retrying keeps failing.
  errorComponent: ({ error }) => <RouteError error={error} />,
});

/**
 * `reset` from the catch boundary only clears its own error state, so the match
 * throws the same error straight back. Invalidating changes the match identity,
 * which both re-runs the load and lets the boundary reset itself.
 */
function RouteError({ error }: { error: Error }) {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold text-balance">Terjadi kesalahan</h1>
      <p className="mt-2 text-sm text-pretty text-muted-foreground">
        Halaman ini gagal dimuat. Coba lagi, atau kembali ke beranda.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button onClick={() => void router.invalidate()}>Coba lagi</Button>
        <Button variant="outline" render={<Link to="/" />}>
          Kembali ke beranda
        </Button>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">{error.message}</p>
    </main>
  );
}
