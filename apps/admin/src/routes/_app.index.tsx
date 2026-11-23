import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({ component: Dashboard });

function Dashboard() {
  return (
    <>
      <h1 tabIndex={-1} className="text-xl font-semibold outline-none">
        Dasbor
      </h1>
      <div className="grid gap-1 text-sm">
        <h2 className="font-semibold">Belum ada data</h2>
        <p className="max-w-[60ch] text-pretty text-muted-foreground">
          Daftar pendaftaran belum tersedia di aplikasi ini.
        </p>
      </div>
    </>
  );
}
