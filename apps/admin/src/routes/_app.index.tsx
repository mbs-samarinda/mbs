import { serverNow } from "@mbs/api-client/http";
import type { CommitteeDashboard } from "@mbs/api-contract";
import { formatDate } from "@mbs/school-config/format";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "cn";

import { eventEntry, SchoolMark, schoolMarkClass, Timeline } from "../committee-ui.tsx";
import { firstName, formatCount, formatWaited } from "../format.ts";
import { dashboardQuery } from "../staff.ts";

export const Route = createFileRoute("/_app/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery),
  head: () => ({ meta: [{ title: "Beranda · Panitia PPDB" }] }),
  component: Home,
});

function Home() {
  const { data } = useSuspenseQuery(dashboardQuery);
  return (
    <div className="grid content-start gap-8 p-[min(2rem,5vw)]">
      <div className="grid gap-1">
        <h1 tabIndex={-1} className="text-2xl font-semibold outline-none">
          Beranda
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">{cycleLine(data.cycle)}</p>
      </div>
      <Stats data={data} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <PerSchool perSchool={data.perSchool} />
        <section className="grid content-start gap-4">
          <h2 className="flex flex-wrap items-baseline justify-between gap-x-4 font-semibold">
            Aktivitas terbaru
            <Link
              to="/pendaftar"
              className="text-sm font-normal text-muted-foreground hover:text-foreground hover:underline"
            >
              Lihat pendaftar
            </Link>
          </h2>
          {data.recent.length > 0 ? (
            <Timeline
              entries={data.recent.map((item, index) => ({
                ...eventEntry(String(index), item),
                child: (
                  <Link
                    to="/pendaftar/$applicationId"
                    params={{ applicationId: item.applicationId }}
                    className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {firstName(item.childName)}
                  </Link>
                ),
              }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada aktivitas.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function cycleLine(cycle: CommitteeDashboard["cycle"]) {
  if (!cycle) return "Belum ada periode pendaftaran.";
  const closed = Date.parse(cycle.closesAt) <= serverNow().getTime();
  return (
    <>
      {cycle.name} · pendaftaran {closed ? "sudah ditutup" : "ditutup"}{" "}
      <span className="whitespace-nowrap">{formatDate(cycle.closesAt)}</span>
    </>
  );
}

/** Every number has a plain sentence for zero, so an empty cycle never shows NaN or a blank. */
function Stats({ data }: { data: CommitteeDashboard }) {
  const tiles: [label: string, value: number, sub: string][] = [
    [
      "Pendaftar",
      data.total,
      data.newThisWeek > 0
        ? `+${formatCount(data.newThisWeek)} minggu ini`
        : "Belum ada minggu ini",
    ],
    [
      "Sudah bayar",
      data.paid,
      // Rounded down, so 2.499 of 2.500 never reads as 100%.
      data.total > 0
        ? `${Math.floor((data.paid / data.total) * 100)}% dari pendaftar`
        : "Belum ada pendaftar",
    ],
    [
      "Perlu dicek",
      data.needsCommittee,
      data.oldestWaitingSince
        ? `terlama ${formatWaited(data.oldestWaitingSince)}`
        : "Tidak ada antrean",
    ],
    [
      "Diterima",
      data.accepted,
      data.decided > 0
        ? `dari ${formatCount(data.decided)} yang diputuskan`
        : "Belum ada yang diputuskan",
    ],
  ];
  return (
    <dl className="grid grid-cols-4 border-y border-border max-md:grid-cols-2 md:divide-x md:divide-border">
      {tiles.map(([label, value, sub]) => (
        <div key={label} className="grid content-start gap-1 py-4 md:px-5 md:first:pl-0">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="text-3xl font-semibold tabular-nums">{formatCount(value)}</dd>
          <dd className="text-xs text-pretty text-muted-foreground">{sub}</dd>
        </div>
      ))}
    </dl>
  );
}

function PerSchool({ perSchool }: { perSchool: CommitteeDashboard["perSchool"] }) {
  const most = Math.max(0, ...perSchool.map((school) => school.total));
  return (
    <section className="grid content-start gap-4">
      <h2 className="font-semibold">Pendaftar per sekolah</h2>
      {perSchool.length === 0 && (
        <p className="text-sm text-pretty text-muted-foreground">
          Akun kamu belum terhubung ke sekolah mana pun. Minta administrator menambahkannya.
        </p>
      )}
      {perSchool.map(({ schoolKey, total }) => (
        <div key={schoolKey} className="grid gap-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <SchoolMark school={schoolKey} />
            <span className="tabular-nums">{formatCount(total)}</span>
          </div>
          <div aria-hidden className="h-2 rounded-sm bg-muted">
            <div
              className={cn("h-2 rounded-sm", schoolMarkClass(schoolKey))}
              style={{ width: most > 0 ? `${(total / most) * 100}%` : 0 }}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
