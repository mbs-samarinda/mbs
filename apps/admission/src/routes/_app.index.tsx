import { serverNow } from "@mbs/api-client/http";
import type { FamilyApplicationSummary, PublicAdmissionCycle } from "@mbs/api-contract";
import { SCHOOL_KEYS, type SchoolKey } from "@mbs/school-config";
import { buttonVariants } from "@mbs/ui/components/button";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { applicationsQuery } from "../api.ts";
import { cyclesQuery, sortByPhase, type SchoolCycle } from "../cycles.ts";
import { editDraft, isStarted, useDraft, type Draft } from "../draft.ts";
import {
  formatDate,
  formatDateTime,
  formatFee,
  formatList,
  formatTime,
  schoolName,
} from "../format.ts";
import { SchoolLogo } from "../school-logo.tsx";
import { STAGE_COPY, TURNS } from "../stage-copy.ts";

export const Route = createFileRoute("/_app/")({
  loader: ({ context: { queryClient, account } }) =>
    Promise.all([
      queryClient.ensureQueryData(applicationsQuery(account.id)),
      queryClient.ensureQueryData(cyclesQuery),
    ]),
  component: Home,
});

const FRESH = { refetchOnMount: "always", refetchOnWindowFocus: "always" } as const;

function Home() {
  const { account } = Route.useRouteContext();
  const { data: applications } = useSuspenseQuery({ ...applicationsQuery(account.id), ...FRESH });
  const { data: schools } = useSuspenseQuery({ ...cyclesQuery, ...FRESH });
  const { draft } = useDraft(account.id);

  const phases = sortByPhase(schools, serverNow());
  const isOpen = phases.open.length > 0;
  const toContinue = draft && isStarted(draft) && (isOpen || draft.attempt) ? draft : null;

  if (applications.length === 0 && !toContinue) return <Start phases={phases} />;
  return (
    <>
      <Title>Pendaftaran</Title>
      <ul className="-mt-4 divide-y divide-border border-y border-border">
        {toContinue && <DraftRow draft={toContinue} />}
        {applications.map((application) => (
          <ApplicationRow key={application.id} application={application} />
        ))}
      </ul>
      {isOpen && !toContinue && (
        <Link
          to="/daftar"
          className={cn(
            buttonVariants({ variant: "outline", size: "touch" }),
            "justify-self-start",
          )}
        >
          Daftarkan anak lain
        </Link>
      )}
    </>
  );
}

function Title({ children }: { children: ReactNode }) {
  return (
    <h1 tabIndex={-1} className="text-2xl font-semibold text-balance outline-none">
      {children}
    </h1>
  );
}

/** The logo goes above the words when large text leaves them no room beside it. */
const ROW = "flex flex-wrap items-center gap-4 py-4";
const WORDS = "flex min-w-0 flex-[1_1_12rem] items-center gap-4";

function ApplicationRow({ application }: { application: FamilyApplicationSummary }) {
  const { turn, title } = STAGE_COPY[application.stage];
  return (
    <li>
      <Link to="/status/$applicationId" params={{ applicationId: application.id }} className={ROW}>
        <SchoolLogo school={application.schoolKey} className="size-10" />
        <div className={WORDS}>
          <div className="min-w-0 flex-1 wrap-anywhere">
            <p className="font-semibold">{application.childName}</p>
            <p className="text-sm text-muted-foreground">{schoolName(application.schoolKey)}</p>
            <p className="mt-1 text-sm">
              <span className={cn("font-medium", turn === "FAMILY" && "text-primary")}>
                {title}
              </span>
              {turn !== "NOBODY" && <span className="text-muted-foreground"> · {TURNS[turn]}</span>}
            </p>
          </div>
          <Chevron />
        </div>
      </Link>
    </li>
  );
}

function DraftRow({ draft: { values, attempt } }: { draft: Draft }) {
  const school = SCHOOL_KEYS.find((key) => key === values.schoolKey);
  return (
    <li>
      <Link to="/daftar" className={ROW}>
        {school ? (
          <SchoolLogo school={school} className="size-10" />
        ) : (
          <span className="size-10 shrink-0" />
        )}
        <div className={WORDS}>
          <div className="min-w-0 flex-1 wrap-anywhere">
            <p className="font-semibold">{values.childFullName.trim() || "Pendaftaran baru"}</p>
            {school && <p className="text-sm text-muted-foreground">{schoolName(school)}</p>}
            <p className="mt-1 text-sm">
              <span className="font-medium text-primary">
                {attempt ? "Belum pasti terkirim" : "Belum dikirim"}
              </span>
              <span className="text-muted-foreground"> · Lanjutkan isian</span>
            </p>
          </div>
          <Chevron />
        </div>
      </Link>
    </li>
  );
}

function Chevron() {
  return <ChevronRightIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />;
}

/** The page before the first child: what can be done now, or when. */
function Start({ phases: { open, soon, closed } }: { phases: ReturnType<typeof sortByPhase> }) {
  if (open.length > 0) return <ChooseSchool open={open} />;
  if (soon.length > 0) {
    const { cycle } = soon[0]!;
    return (
      <Notice title={`Pendaftaran dibuka ${formatDate(cycle.registrationOpenAt)}`}>
        Pendaftaran {cycle.name}
        {where(soon)} dibuka pukul {formatTime(cycle.registrationOpenAt)}. Setelah itu, kamu bisa
        mendaftarkan anak dari halaman ini.
      </Notice>
    );
  }
  if (closed.length > 0) {
    const { cycle } = closed[0]!;
    return (
      <Notice title="Pendaftaran sudah ditutup">
        Pendaftaran {cycle.name}
        {where(closed)} ditutup
        {closingTime(cycle)}. Jadwal berikutnya muncul di halaman ini.
      </Notice>
    );
  }
  return (
    <Notice title="Pendaftaran belum dibuka">
      Jadwalnya belum diumumkan. Begitu ada, tanggalnya muncul di halaman ini.
    </Notice>
  );
}

/** The committee can close early, and then the planned date is not when it closed. */
function closingTime(cycle: PublicAdmissionCycle) {
  const planned = cycle.registrationCloseAt;
  return Date.parse(planned) <= serverNow().getTime() ? ` ${formatDate(planned)}` : "";
}

/** Names the schools only when they differ. */
function where(schools: readonly SchoolCycle[]) {
  return schools.length === SCHOOL_KEYS.length
    ? ""
    : ` di ${names(schools.map((s) => s.schoolKey))}`;
}

function names(keys: readonly SchoolKey[]) {
  return formatList(keys.map(schoolName));
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Title>{title}</Title>
      <p className="max-w-[60ch] text-pretty text-muted-foreground">{children}</p>
    </div>
  );
}

function ChooseSchool({ open }: { open: ReturnType<typeof sortByPhase>["open"] }) {
  const { account } = Route.useRouteContext();
  const { cycle } = open[0]!;
  const others = SCHOOL_KEYS.filter((key) => !open.some(({ schoolKey }) => schoolKey === key));
  return (
    <>
      <Notice title="Pilih sekolah">
        Pendaftaran {cycle.name} dibuka sampai {formatDateTime(cycle.registrationCloseAt)}.
        {others.length > 0 && ` ${names(others)} tidak menerima pendaftaran saat ini.`}
      </Notice>
      <ul className="-mt-2 divide-y divide-border border-y border-border">
        {open.map(({ schoolKey, cycle: { effectiveFee } }) => (
          <li key={schoolKey}>
            <Link
              to="/daftar/$langkah"
              params={{ langkah: "anak" }}
              onClick={() => editDraft(account.id, { schoolKey })}
              className={ROW}
            >
              <SchoolLogo school={schoolKey} className="size-12" />
              <div className={WORDS}>
                <div className="min-w-0 flex-1 wrap-anywhere">
                  <p className="font-semibold">{schoolName(schoolKey)}</p>
                  <p className="text-sm text-muted-foreground">
                    Biaya pendaftaran {formatFee(effectiveFee)}
                  </p>
                </div>
                <Chevron />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
