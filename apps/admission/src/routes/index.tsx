import { Button } from "@mbs/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../api.ts";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const cycle = useQuery(
    api.public.admission.getCurrentCycle.queryOptions({ input: { schoolKey: "sma" } }),
  );

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Pendaftaran MBSS</h1>
      <p className="mt-2 text-sm text-gray-600">
        {cycle.isPending
          ? "Memuat…"
          : (cycle.data?.name ?? "Belum ada gelombang pendaftaran yang dibuka.")}
      </p>
      <Button className="mt-6">Mulai</Button>
    </main>
  );
}
