import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Halaman tidak ditemukan</h1>
      <Link to="/" className="mt-4 inline-block text-sm underline">
        Kembali ke beranda
      </Link>
    </main>
  ),
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Terjadi kesalahan</h1>
      <p className="mt-2 text-sm text-gray-600">{error.message}</p>
    </main>
  ),
});
