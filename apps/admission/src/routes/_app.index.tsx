import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({ component: Home });

function Home() {
  return (
    <>
      <h1 tabIndex={-1} className="text-2xl font-semibold outline-none">
        Pendaftaran
      </h1>
      <div className="grid gap-1">
        <h2 className="font-semibold">Belum ada pendaftaran</h2>
        <p className="max-w-[60ch] text-pretty text-muted-foreground">
          Formulir pendaftaran belum tersedia. Kamu belum perlu melakukan apa pun.
        </p>
      </div>
    </>
  );
}
