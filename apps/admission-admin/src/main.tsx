import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { routeTree } from "./routeTree.gen.ts";

import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The default of 0 refetches on every mount and window focus. Two minutes
      // is the docs' suggested starting point.
      staleTime: 2 * 60 * 1000,
      // The default retries three times with backoff. A refused request will be
      // refused again, so retrying an UNAUTHORIZED only delays the redirect to
      // the sign-in page by several seconds.
      retry: (failureCount, error) => {
        const status =
          typeof error === "object" && error !== null && "status" in error ? error.status : null;
        if (typeof status === "number" && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  // TanStack Query owns freshness. Without this the router keeps its own
  // 30-second preload cache on top and the two disagree.
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
