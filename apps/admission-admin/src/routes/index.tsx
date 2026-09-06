import { Button } from "@mbs/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../api.ts";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const cycle = useQuery(
    api.public.admission.getCurrentCycle.queryOptions({ input: { schoolKey: "sma" } }),
  );

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Panitia MBSS</h1>
      <p className="mt-2 text-sm text-gray-600">
        {cycle.isPending ? "Memuat…" : (cycle.data?.name ?? "Belum ada gelombang aktif.")}
      </p>
      <Button className="mt-6" variant="secondary">
        Lihat pendaftar
      </Button>
    </main>
  );
}
