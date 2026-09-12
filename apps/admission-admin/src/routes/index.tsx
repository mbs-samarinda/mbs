import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Panitia MBSS</h1>
      <p className="mt-2 text-sm text-muted-foreground">Belum ada layar di sini.</p>
    </main>
  );
}
