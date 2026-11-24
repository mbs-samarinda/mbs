import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";

/**
 * Refused here so the pages' loaders never make an admin call. The API refuses
 * non-administrators on its own as well.
 */
export const Route = createFileRoute("/_app/pengaturan")({
  beforeLoad: ({ context }) => {
    if (context.visitor.kind !== "staff" || context.visitor.staff.role !== "ADMINISTRATOR") {
      throw notFound();
    }
  },
  notFoundComponent: Forbidden,
  component: Outlet,
});

function Forbidden() {
  return (
    <div className="grid content-start gap-1 p-[min(2rem,5vw)]">
      <h1 tabIndex={-1} className="text-2xl font-semibold outline-none">
        Pengaturan
      </h1>
      <p className="text-sm text-pretty text-muted-foreground">
        Hanya administrator yang bisa membuka halaman ini.
      </p>
    </div>
  );
}
