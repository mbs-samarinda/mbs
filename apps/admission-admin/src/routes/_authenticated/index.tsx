import { Button } from "@mbs/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { api } from "../../api.ts";

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
});

function Dashboard() {
  const { staff } = Route.useRouteContext();
  const cycle = useQuery(
    api.public.admission.getCurrentCycle.queryOptions({ input: { schoolKey: "sma" } }),
  );

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Panitia MBSS</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {cycle.isPending ? "Memuat…" : (cycle.data?.name ?? "Belum ada gelombang aktif.")}
      </p>
      <div className="mt-6 flex gap-2">
        <Button variant="secondary">Lihat pendaftar</Button>
        {/* The staff page is administrator-only and its route redirects anyone
            else, so the link only appears for the people it works for. */}
        {staff.role === "ADMINISTRATOR" ? (
          <Button variant="outline" render={<Link to="/staff" />}>
            Akses staf
          </Button>
        ) : null}
      </div>
    </main>
  );
}
