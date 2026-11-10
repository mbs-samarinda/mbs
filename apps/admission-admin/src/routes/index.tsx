import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  // Better Auth sends a refused sign-in back here with `?error=<code>`.
  validateSearch: (search: Record<string, unknown>): { error?: string } =>
    typeof search.error === "string" ? { error: search.error } : {},
  component: Home,
});

// The API's sign-in gate sends this code for an address nobody approved
// (apps/api/src/modules/auth/auth.ts). Any other code is a failed sign-in.
const NOT_APPROVED = "account_not_approved";

function signInMessage(error: string | undefined) {
  if (error === undefined) return "Belum ada layar di sini.";
  return error === NOT_APPROVED ? "Akun ini tidak punya akses." : "Masuk gagal. Coba lagi.";
}

function Home() {
  const { error } = Route.useSearch();

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Panitia MBSS</h1>
      <p className="mt-2 text-sm text-muted-foreground">{signInMessage(error)}</p>
    </main>
  );
}
