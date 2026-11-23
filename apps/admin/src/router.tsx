import { UnreachableError } from "@mbs/api-client/http";
import { Button, buttonVariants } from "@mbs/ui/components/button";
import { StatusPage } from "@mbs/ui/components/status-page";
import { QueryClient } from "@tanstack/react-query";
import {
  createRouter,
  Link,
  useRouter,
  type ErrorComponentProps,
  type RouterHistory,
} from "@tanstack/react-router";
import { cn } from "cn";

import { APP_NAME } from "./app-name.ts";
import { routeTree } from "./routeTree.gen.ts";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * 60 * 1000,
        retry: (failures, error) => error instanceof UnreachableError && failures < 1,
        // The default waits in silence while offline. Failing at once lets the
        // screen say so.
        networkMode: "always",
      },
      mutations: { networkMode: "always" },
    },
  });
}

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    ...(history ? { history } : {}),
    defaultPreload: "intent",
    // TanStack Query owns freshness. Without this the router keeps its own
    // 30-second preload cache on top and the two disagree.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    // Here and not on a route, because a route's copy is a separate file, which
    // cannot load when the server is the thing that is down.
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: NotFoundPage,
    defaultPendingComponent: PendingPage,
    defaultPendingMs: 500,
  });

  // A page change moves nothing for a screen reader on its own. A screen that
  // already put focus in a field keeps it there.
  router.subscribe("onRendered", ({ fromLocation, pathChanged }) => {
    if (!fromLocation || !pathChanged || document.activeElement !== document.body) return;
    document.querySelector("h1")?.focus();
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

/**
 * `reset` from the catch boundary only clears its own error state, so the match
 * throws the same error straight back. Invalidating runs the load again too.
 */
function ErrorPage({ error }: ErrorComponentProps) {
  const router = useRouter();
  const unreachable = error instanceof UnreachableError;
  return (
    <StatusPage
      sub={APP_NAME}
      title={unreachable ? "Server tidak bisa dihubungi" : "Halaman ini gagal dimuat"}
      body={
        unreachable
          ? "Periksa koneksi internet kamu, lalu coba lagi."
          : "Ada gangguan di sistem kami. Coba lagi, atau buka halaman utama."
      }
      actions={
        <>
          <Button onClick={() => void router.invalidate()}>Coba lagi</Button>
          {!unreachable && (
            <a href="/" className={cn(buttonVariants({ variant: "outline" }))}>
              Buka halaman utama
            </a>
          )}
        </>
      }
    />
  );
}

function NotFoundPage() {
  return (
    <StatusPage
      sub={APP_NAME}
      title="Halaman tidak ditemukan"
      body="Periksa lagi alamatnya, atau buka halaman utama."
      actions={
        <Link to="/" className={cn(buttonVariants())}>
          Buka halaman utama
        </Link>
      }
    />
  );
}

function PendingPage() {
  return <StatusPage sub={APP_NAME} title="Memuat…" body="" actions={null} />;
}
