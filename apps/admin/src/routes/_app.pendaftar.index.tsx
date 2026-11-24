import type { CommitteeApplicationRow, ListApplicationsInput } from "@mbs/api-contract";
import { isSchoolKey, SCHOOL_KEYS, type SchoolKey } from "@mbs/school-config";
import { buttonVariants } from "@mbs/ui/components/button";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  chipClass,
  commandLabel,
  SchoolMark,
  schoolShortName,
  Stage,
  Tile,
} from "../committee-ui.tsx";
import { formatAgo, formatCount } from "../format.ts";
import { applicationsQuery } from "../staff.ts";

/** Indonesian keys, like `/masuk?lanjut=`. Every key is always set, so nothing unchecked slips through. */
type ListSearch = {
  sekolah?: SchoolKey | undefined;
  tampil?: "perlu" | undefined;
  cari?: string | undefined;
  halaman?: number | undefined;
};

const SEARCH_MAX = 100;

export const Route = createFileRoute("/_app/pendaftar/")({
  validateSearch: (search: Record<string, unknown>): ListSearch => {
    // The router reads `?cari=2025` as a number.
    const cari = ["string", "number"].includes(typeof search.cari)
      ? String(search.cari).trim().slice(0, SEARCH_MAX)
      : "";
    const halaman = Number(search.halaman);
    return {
      sekolah:
        typeof search.sekolah === "string" && isSchoolKey(search.sekolah)
          ? search.sekolah
          : undefined,
      tampil: search.tampil === "perlu" ? "perlu" : undefined,
      cari: cari || undefined,
      halaman: Number.isInteger(halaman) && halaman > 1 ? halaman : undefined,
    };
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(applicationsQuery(toInput(deps))),
  head: () => ({ meta: [{ title: "Pendaftar · Panitia PPDB" }] }),
  component: List,
});

function toInput(search: ListSearch): ListApplicationsInput {
  return {
    school: search.sekolah,
    view: search.tampil === "perlu" ? "NEEDS_COMMITTEE" : "ALL",
    q: search.cari,
    page: search.halaman ?? 1,
  };
}

/** The row a visitor opened, so going back puts focus on it again. */
const RETURN_TO = "pendaftar:dibuka";

function List() {
  const search = Route.useSearch();
  const { visitor } = Route.useRouteContext();
  const { data } = useSuspenseQuery(applicationsQuery(toInput(search)));
  const schools = SCHOOL_KEYS.filter(
    (key) => visitor.kind === "staff" && visitor.staff.schools.includes(key),
  );
  const filtered =
    search.sekolah !== undefined || search.tampil !== undefined || search.cari !== undefined;

  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const id = sessionStorage.getItem(RETURN_TO);
    if (!id) return;
    sessionStorage.removeItem(RETURN_TO);
    listRef.current
      ?.querySelector<HTMLAnchorElement>(`a[data-id="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: true });
  }, []);

  const first = (data.page - 1) * data.pageSize + 1;
  const last = first + data.rows.length - 1;
  return (
    <div className="grid content-start gap-6 p-[min(2rem,5vw)]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 tabIndex={-1} className="text-2xl font-semibold outline-none">
            Pendaftar
          </h1>
          <p className="text-sm text-muted-foreground">{summary(data.total, search)}</p>
        </div>
        <SearchBox value={search.cari} />
      </div>
      <nav aria-label="Saring pendaftar" className="flex flex-wrap gap-1">
        <Link
          to="/pendaftar"
          search={{ cari: search.cari }}
          className={chipClass(search.sekolah === undefined && search.tampil === undefined)}
        >
          Semua
        </Link>
        {schools.length > 1 &&
          schools.map((key) => (
            <Link
              key={key}
              to="/pendaftar"
              search={{ sekolah: key, cari: search.cari }}
              className={chipClass(search.sekolah === key)}
            >
              {schoolShortName(key)}
            </Link>
          ))}
        <Link
          to="/pendaftar"
          search={{ tampil: "perlu", cari: search.cari }}
          className={chipClass(search.tampil === "perlu")}
        >
          Perlu dicek
        </Link>
      </nav>

      {data.rows.length > 0 ? (
        <ul ref={listRef} className="grid divide-y divide-border">
          <li
            aria-hidden
            className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-6 pb-2 text-xs text-muted-foreground max-md:hidden"
          >
            <span>Anak</span>
            <span>Wali</span>
            <span>Tahap</span>
            <span>Terakhir</span>
          </li>
          {data.rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </ul>
      ) : (
        <p className="py-10 text-center text-sm text-pretty text-muted-foreground">
          {data.total > 0
            ? "Halaman ini kosong."
            : filtered
              ? "Tidak ada pendaftar yang cocok."
              : "Belum ada pendaftar."}
        </p>
      )}

      {data.total > data.pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {data.rows.length > 0
              ? `${formatCount(first)} sampai ${formatCount(last)} dari ${formatCount(data.total)}`
              : `${formatCount(data.total)} pendaftar`}
          </span>
          <div className="flex gap-2">
            <PageLink page={data.page - 1} disabled={data.page <= 1}>
              Sebelumnya
            </PageLink>
            <PageLink page={data.page + 1} disabled={last >= data.total || data.rows.length === 0}>
              Berikutnya
            </PageLink>
          </div>
        </div>
      )}
    </div>
  );
}

function summary(total: number, search: ListSearch) {
  const children = `${formatCount(total)} anak`;
  if (search.tampil === "perlu") return `${children} menunggu panitia`;
  if (search.sekolah) return `${children} di ${schoolShortName(search.sekolah)}`;
  return children;
}

/** A link, so Enter opens it and the browser's own back returns here. */
function Row({ row }: { row: CommitteeApplicationRow }) {
  return (
    <li>
      <Link
        to="/pendaftar/$applicationId"
        params={{ applicationId: row.id }}
        data-id={row.id}
        onClick={() => sessionStorage.setItem(RETURN_TO, row.id)}
        className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-6 py-3 hover:bg-muted/50 max-md:grid-cols-1 max-md:gap-2"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Tile name={row.childName} school={row.schoolKey} />
          <span className="grid min-w-0">
            <span className="truncate font-medium" title={row.childName}>
              {row.childName}
            </span>
            <span className="text-sm text-muted-foreground">
              <SchoolMark school={row.schoolKey} />
            </span>
          </span>
        </span>
        <span className="grid min-w-0 text-sm max-md:hidden">
          <span className="truncate" title={row.guardianName}>
            {row.guardianName}
          </span>
          <span className="text-muted-foreground tabular-nums">{row.guardianPhone}</span>
        </span>
        <span className="max-md:pl-12">
          <Stage stage={row.stage} needsCommittee={row.needsCommittee} />
        </span>
        <span className="grid min-w-0 text-sm max-md:hidden">
          <span className="truncate" title={commandLabel(row.lastActivity.command)}>
            {commandLabel(row.lastActivity.command)}
          </span>
          <span className="text-muted-foreground">{formatAgo(row.lastActivity.at)}</span>
        </span>
      </Link>
    </li>
  );
}

function PageLink({
  page,
  disabled,
  children,
}: {
  page: number;
  disabled: boolean;
  children: string;
}) {
  const className = cn(buttonVariants({ variant: "outline", size: "sm" }));
  if (disabled) {
    return (
      <span aria-disabled className={cn(className, "pointer-events-none opacity-50")}>
        {children}
      </span>
    );
  }
  return (
    <Link
      to="/pendaftar"
      from={Route.fullPath}
      search={(previous) => ({ ...previous, halaman: page > 1 ? page : undefined })}
      className={className}
    >
      {children}
    </Link>
  );
}

/** Never matches a NIK on purpose: the text goes into the address and the browser's history. */
function SearchBox({ value }: { value: string | undefined }) {
  const navigate = useNavigate({ from: "/pendaftar/" });
  const [text, setText] = useState(value ?? "");
  const [shown, setShown] = useState(value);

  // A link elsewhere can change the search. Typing a trailing space must not undo itself.
  if (shown !== value) {
    setShown(value);
    if (text.trim() !== (value ?? "")) setText(value ?? "");
  }

  useEffect(() => {
    const wanted = text.trim().slice(0, SEARCH_MAX) || undefined;
    const timer = setTimeout(() => {
      if (wanted === value) return;
      void navigate({
        search: (previous) => ({ ...previous, cari: wanted, halaman: undefined }),
        replace: true,
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [text, value, navigate]);

  return (
    <label className="flex h-9 w-full max-w-80 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
      <SearchIcon aria-hidden className="size-4 shrink-0" />
      <input
        type="search"
        aria-label="Cari pendaftar"
        placeholder="Cari anak, wali, atau nomor"
        maxLength={SEARCH_MAX}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}
