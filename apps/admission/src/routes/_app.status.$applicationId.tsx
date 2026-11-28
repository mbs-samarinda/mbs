import { ORPCError } from "@mbs/api-client/rpc";
import type { FamilyApplication } from "@mbs/api-contract";
import { finishedMilestones } from "@mbs/school-config";
import { formatDateTime } from "@mbs/school-config/format";
import { buttonVariants } from "@mbs/ui/components/button";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowLeftIcon, FileTextIcon } from "lucide-react";
import { useState } from "react";

import { applicationQuery, paymentQuery } from "../api.ts";
import { useDraft } from "../draft.ts";
import { formatBytes } from "../format.ts";
import { EVENT_TITLES, newestMove, STAGE_COPY, TURNS } from "../stage-copy.ts";
import { ApplicationHeader, NextStep, Road } from "../status-parts.tsx";

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
  const { turn, title, next } = STAGE_COPY[application.stage];
  const newest = newestMove(application);
  return (
    <>
      <Link
        to="/"
        className="-mb-4 inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        Semua pendaftaran
      </Link>
      <ApplicationHeader application={application} />
      {ubahan === "tertinggal" && <EditsNotSent />}
      {ubahan === "tersimpan" && draft && <EditsKept />}
      <NextStep turn={TURNS[turn]} title={title}>
        <p className="text-pretty">{next(application)}</p>
        {newest?.reason && <Reason>{newest.reason}</Reason>}
        {application.stage === "PAYMENT_DUE" && (
          <Link
            to="/bayar/$applicationId"
            params={{ applicationId }}
            className={cn(buttonVariants({ size: "touch" }), "mt-3 w-full justify-center")}
          >
            Bayar
          </Link>
        )}
        {application.stage === "PAYMENT_REVIEW" && (
          <SentProof accountId={account.id} applicationId={applicationId} />
        )}
      </NextStep>
      <Road
        stage={application.stage}
        finished={finishedMilestones(application.events, {
          registrationFee: application.registrationFee,
        })}
      />
      <History events={application.events} />
    </>
  );
}

function SentProof({ accountId, applicationId }: { accountId: string; applicationId: string }) {
  const { data } = useQuery(paymentQuery(accountId, applicationId));
  const [failed, setFailed] = useState(false);
  const attempt = data?.attempts[0];
  if (!attempt) return null;

  const caption = `Dikirim ${formatDateTime(attempt.sentAt)}`;
  const image = attempt.file.contentType.startsWith("image/") && !failed;
  return (
    <div className="mt-2 grid min-w-0 gap-2">
      {image ? (
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={attempt.url}
            alt="Bukti transfer yang kamu kirim"
            onError={() => setFailed(true)}
            className="h-20 w-16 shrink-0 rounded-lg border border-border bg-white object-contain"
          />
          <p className="min-w-0 text-sm text-muted-foreground">{caption}</p>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-2.5">
            <FileTextIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">Bukti transfer</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatBytes(attempt.file.byteSize)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{caption}</p>
        </>
      )}
    </div>
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

function Reason({ children }: { children: string }) {
  return <p className="text-sm text-pretty whitespace-pre-line">Catatan panitia: {children}</p>;
}

function History({ events }: Pick<FamilyApplication, "events">) {
  return (
    <section className="grid gap-4 border-t border-border pt-6">
      <h2 className="font-semibold">Riwayat</h2>
      <ol className="grid gap-4">
        {events.toReversed().map(({ command, actor, at, reason }) => {
          const title = EVENT_TITLES[command];
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
