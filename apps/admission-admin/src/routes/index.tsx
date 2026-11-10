import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  // Better Auth sends a refused sign-in back here with `?error=<code>`.
  validateSearch: (search: Record<string, unknown>): { error?: string } =>
    typeof search.error === "string" ? { error: search.error } : {},
  component: Home,
});

function Home() {
  const { error } = Route.useSearch();

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Panitia MBSS</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {error ? "Akun ini tidak punya akses." : "Belum ada layar di sini."}
      </p>
    </main>
  );
}
