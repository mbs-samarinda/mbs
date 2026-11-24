import { ORPCError } from "@mbs/api-client/rpc";
import type { FamilyApplication } from "@mbs/api-contract";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowLeftIcon, CheckIcon } from "lucide-react";

import { applicationQuery } from "../api.ts";
import { useDraft } from "../draft.ts";
import { formatDateTime, formatDayAndMonth, schoolName } from "../format.ts";
import { SchoolLogo } from "../school-logo.tsx";
import { EVENT_COPY, MILESTONES, newestMove, STAGE_COPY, TURNS } from "../stage-copy.ts";

/** Set when the form was sent before its last edits, so the page can say what became of them. */
type StatusSearch = { ubahan?: "tertinggal" | "tersimpan" | undefined };

export const Route = createFileRoute("/_app/status/$applicationId")({
  validateSearch: ({ ubahan }: Record<string, unknown>): StatusSearch => ({
    ubahan: ubahan === "tertinggal" || ubahan === "tersimpan" ? ubahan : undefined,
  }),
  loader: async ({ context: { queryClient, account }, params }) => {
    try {
      await queryClient.ensureQueryData(applicationQuery(account.id, params.applicationId));
    } catch (error) {
      // Not theirs, not there and not an id at all are the same answer.
      if (error instanceof ORPCError && ["NOT_FOUND", "BAD_REQUEST"].includes(error.code)) {
        throw notFound();
      }
      throw error;
    }
  },
  head: () => ({ meta: [{ title: "Status pendaftaran · Madina Boarding School" }] }),
  component: Status,
});

function Status() {
  const { account } = Route.useRouteContext();
  const { applicationId } = Route.useParams();
  const { ubahan } = Route.useSearch();
  const { draft } = useDraft(account.id);
  const { data: application } = useSuspenseQuery({
    ...applicationQuery(account.id, applicationId),
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  return (
    <>
      <Link
        to="/"
        className="-mb-4 inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        Semua pendaftaran
      </Link>
      {/* The name drops under the logo when large text leaves it no room. */}
      <div className="flex flex-wrap items-center gap-4">
        <SchoolLogo school={application.schoolKey} className="size-14" />
        <div className="min-w-0 flex-[1_1_11rem] wrap-anywhere">
          <h1 tabIndex={-1} className="text-xl font-semibold text-balance outline-none">
            {application.childName}
          </h1>
          <p className="text-sm text-muted-foreground">{schoolName(application.schoolKey)}</p>
          <p className="text-sm text-muted-foreground tabular-nums">
            Nomor pendaftaran{" "}
            <span className="font-medium text-foreground">{application.registrationNumber}</span>
          </p>
        </div>
      </div>
      {ubahan === "tertinggal" && <EditsNotSent />}
      {ubahan === "tersimpan" && draft && <EditsKept />}
      <NextStep application={application} />
      <Road application={application} />
      <History events={application.events} />
    </>
  );
}

const NOTICE =
  "grid gap-1 rounded-xl bg-warning-tint p-[min(1.25rem,6vw)] text-pretty text-warning";

function EditsNotSent() {
  return (
    <p className={NOTICE}>
      Pendaftaran ini sudah terkirim sebelum isiannya kamu ubah, jadi ubahan itu tidak ikut
      terkirim. Kalau ada data yang perlu diperbaiki, hubungi panitia.
    </p>
  );
}

function EditsKept() {
  return (
    <div className={NOTICE}>
      <p>
        Pendaftaran ini sudah terkirim lebih dulu. Isian yang baru belum terkirim dan masih ada di
        perangkat ini. Kalau anaknya sama, jangan kirim lagi. Hubungi panitia untuk memperbaiki
        datanya.
      </p>
      <Link
        to="/daftar"
        className="inline-flex min-h-11 items-center justify-self-start font-medium underline underline-offset-4"
      >
        Lanjutkan isian
      </Link>
    </div>
  );
}

function NextStep({ application }: { application: FamilyApplication }) {
  const { turn, title, next } = STAGE_COPY[application.stage];
  const newest = newestMove(application);
  return (
    <section className="grid gap-1.5 rounded-xl bg-info-tint p-[min(1.25rem,6vw)] wrap-anywhere">
      <p className="text-sm font-medium text-info">{TURNS[turn]}</p>
      <h2 className="text-lg font-semibold text-balance">{title}</h2>
      <p className="text-pretty">{next(application)}</p>
      {newest?.reason && <Reason>{newest.reason}</Reason>}
    </section>
  );
}

function Reason({ children }: { children: string }) {
  return <p className="text-sm text-pretty whitespace-pre-line">Catatan panitia: {children}</p>;
}

function Road({ application: { stage, events } }: { application: FamilyApplication }) {
  const { at } = STAGE_COPY[stage];
  const reached = at === null ? MILESTONES.length : MILESTONES.indexOf(at);
  const road = MILESTONES.map((milestone, index) => ({
    milestone,
    finishedAt: events.findLast(({ command }) => EVENT_COPY[command].finishes === milestone)?.at,
    state: index < reached ? "done" : index === reached ? "now" : "next",
  })).filter(
    // A road that ended shows how far it went, not steps that will never come.
    ({ finishedAt }) => at !== null || finishedAt !== undefined,
  );
  return (
    <section className="grid gap-4">
      <h2 className="font-semibold">Tahapan</h2>
      <ol>
        {road.map(({ milestone, finishedAt, state }, index) => (
          <li
            key={milestone}
            aria-current={state === "now" ? "step" : undefined}
            className="relative flex gap-3.5 pb-4 last:pb-0"
          >
            {index < road.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-6 bottom-0 left-[calc(0.75rem-1px)] w-0.5",
                  state === "done" ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <Dot state={state} />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4">
              <span
                className={cn(
                  "min-w-0 wrap-anywhere",
                  state === "now" && "font-semibold",
                  state === "next" && "text-muted-foreground",
                )}
              >
                {milestone}
                <span className="sr-only">
                  {state === "done" ? ", selesai" : state === "now" ? ", sekarang" : ", berikutnya"}
                </span>
              </span>
              {state === "done" && finishedAt && (
                <time dateTime={finishedAt} className="ml-auto text-sm text-muted-foreground">
                  {formatDayAndMonth(finishedAt)}
                </time>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Dot({ state }: { state: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full",
        state === "done" && "bg-primary text-primary-foreground",
        state === "now" && "border-2 border-primary bg-background",
        state === "next" && "border-2 border-border bg-background",
      )}
    >
      {state === "done" && <CheckIcon className="size-3.5" strokeWidth={3} />}
      {state === "now" && <span className="size-2 rounded-full bg-primary" />}
    </span>
  );
}

function History({ events }: Pick<FamilyApplication, "events">) {
  return (
    <section className="grid gap-4 border-t border-border pt-6">
      <h2 className="font-semibold">Riwayat</h2>
      <ol className="grid gap-4">
        {events.toReversed().map(({ command, actor, at, reason }) => {
          const { title } = EVENT_COPY[command];
          return (
            <li key={`${at} ${command}`} className="grid gap-0.5 wrap-anywhere">
              <p className="font-medium">{typeof title === "string" ? title : title(actor)}</p>
              {reason && <Reason>{reason}</Reason>}
              <time dateTime={at} className="text-sm text-muted-foreground tabular-nums">
                {formatDateTime(at)}
              </time>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
