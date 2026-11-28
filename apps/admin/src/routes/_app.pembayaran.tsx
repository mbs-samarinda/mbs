import { ORPCError } from "@mbs/api-client/rpc";
import type { ProofToReview, WaitingProof } from "@mbs/api-contract";
import { Button } from "@mbs/ui/components/button";
import { Textarea } from "@mbs/ui/components/textarea";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import {
  CheckIcon,
  FileTextIcon,
  InboxIcon,
  InfoIcon,
  MessageCircleIcon,
  RotateCwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useId, useState } from "react";

import { SchoolMark } from "../committee-ui.tsx";
import { formatCount, formatRupiah, formatShortDateTime, formatWaited } from "../format.ts";
import { api, proofQuery, waitingProofsQuery } from "../staff.ts";

/** Which proof is open. In the address bar, so a reload opens the same one. */
type DeskSearch = { bukti?: string | undefined };

export const Route = createFileRoute("/_app/pembayaran")({
  validateSearch: ({ bukti }: Record<string, unknown>): DeskSearch => ({
    bukti: typeof bukti === "string" ? bukti : undefined,
  }),
  loader: ({ context: { queryClient } }) => queryClient.ensureInfiniteQueryData(waitingProofsQuery),
  head: () => ({ meta: [{ title: "Pembayaran · Panitia PPDB" }] }),
  component: Desk,
});

function Desk() {
  const { bukti } = Route.useSearch();
  const queue = useInfiniteQuery(waitingProofsQuery);
  const rows = queue.data?.pages.flatMap((page) => page.rows) ?? [];
  const total = queue.data?.pages[0]?.total ?? 0;
  // A proof named in the address bar wins, so the desk stays where it was told
  // to be, even when it sits past the pages the queue has loaded. Otherwise the
  // longest wait is next.
  const open = bukti ?? rows[0]?.paymentId;

  return (
    <div className="grid min-w-0 content-start">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-[min(2rem,5vw)] py-4">
        <div className="grid gap-1">
          <h1 tabIndex={-1} className="text-2xl font-semibold outline-none">
            Pembayaran
          </h1>
          <p className="text-sm text-muted-foreground tabular-nums">
            {total === 0 ? "Tidak ada yang menunggu" : `${formatCount(total)} bukti menunggu dicek`}
          </p>
        </div>
      </div>

      {open === undefined ? (
        <NothingToCheck />
      ) : (
        /*
          Each column scrolls on its own above `lg`, so the proof and its buttons
          stay put however long the queue is. Below `lg` the page scrolls as one.
        */
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] lg:h-[calc(100dvh-5.5rem)] lg:grid-cols-[21rem_minmax(0,1fr)]">
          <Queue
            rows={rows}
            total={total}
            openId={open}
            more={queue.hasNextPage ? () => void queue.fetchNextPage() : null}
            loading={queue.isFetchingNextPage}
          />
          <Pane key={open} paymentId={open} />
        </div>
      )}
    </div>
  );
}

/**
 * Nothing left to check. The end of a review session, not an error, so it says
 * so plainly instead of leaving the screen blank.
 */
function NothingToCheck() {
  return (
    <div className="grid place-items-center gap-3 p-[min(2rem,5vw)] py-24 text-center">
      <InboxIcon aria-hidden className="size-8 text-muted-foreground" />
      <div className="grid gap-1">
        <p className="font-medium">Tidak ada bukti yang menunggu</p>
        <p className="text-sm text-pretty text-muted-foreground">
          Semua bukti transfer sudah dicek. Yang baru muncul di sini sendiri.
        </p>
      </div>
    </div>
  );
}

function Queue({
  rows,
  total,
  openId,
  more,
  loading,
}: {
  rows: WaitingProof[];
  total: number;
  openId: string;
  more: (() => void) | null;
  loading: boolean;
}) {
  return (
    <div className="min-w-0 border-border max-lg:border-b lg:min-h-0 lg:overflow-y-auto lg:border-r">
      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start">
        {rows.map((proof) => (
          <li key={proof.paymentId} className="min-w-0">
            <Link
              to="/pembayaran"
              search={{ bukti: proof.paymentId }}
              aria-current={proof.paymentId === openId ? "true" : undefined}
              className={cn(
                // `minmax(0,1fr)` at both levels: without it the row's own
                // auto width wins and a long name pushes the page sideways.
                "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 border-b border-border px-4 py-3 hover:bg-muted/50",
                proof.paymentId === openId && "bg-muted",
              )}
            >
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium" title={proof.childName}>
                  {proof.childName}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatRupiah(proof.amountDue)}
                </span>
              </div>
              {/*
                The number keeps its own line. Sharing a line with the school
                mark, it was the first thing a long name squeezed out, and it
                is the only thing telling two same-named children apart.
              */}
              <div className="flex min-w-0 items-center justify-between gap-3 text-sm text-muted-foreground">
                <span className="tabular-nums">{proof.registrationNumber}</span>
                <span className="shrink-0">{formatWaited(proof.sentAt)}</span>
              </div>
              <div className="flex min-w-0 text-sm text-muted-foreground">
                <SchoolMark school={proof.schoolKey} />
              </div>
            </Link>
          </li>
        ))}
        {more && (
          <li className="grid justify-items-center gap-1 border-b border-border px-4 py-4">
            <Button variant="outline" size="sm" disabled={loading} onClick={more}>
              {loading ? "Memuat…" : "Tampilkan 50 lagi"}
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatCount(rows.length)} dari {formatCount(total)}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * Afief picked the top bar (28 November 2026): the facts and the decision sit
 * in one row above the proof, so the proof gets the full width for sideways
 * photos and long phone screenshots.
 */
function Pane({ paymentId }: { paymentId: string }) {
  const { data: proof, isPending, isError } = useQuery(proofQuery(paymentId));
  const [shown, setShown] = useState(false);

  // A link to a proof that was decided, or never existed, lands here.
  if (isError) {
    return (
      <div className="grid justify-items-start gap-3 p-[min(2rem,5vw)]">
        <Notice>Bukti ini tidak ada lagi. Mungkin staf lain sudah menanganinya.</Notice>
        <Link
          to="/pembayaran"
          search={{}}
          className="text-sm font-medium underline underline-offset-4"
        >
          Buka bukti yang menunggu
        </Link>
      </div>
    );
  }
  if (isPending || !proof) {
    return <div className="p-[min(2rem,5vw)] text-sm text-muted-foreground">Memuat bukti…</div>;
  }
  return (
    <div className="grid min-w-0 content-start gap-4 p-[min(2rem,5vw)] lg:min-h-0 lg:overflow-y-auto">
      <div className="grid min-w-0 gap-1">
        <h2 className="line-clamp-2 text-lg font-semibold wrap-anywhere" title={proof.childName}>
          <Link
            to="/pendaftar/$applicationId"
            params={{ applicationId: proof.applicationId }}
            className="hover:underline"
          >
            {proof.childName}
          </Link>
        </h2>
        <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          <SchoolMark school={proof.schoolKey} />
          <span className="tabular-nums">{proof.registrationNumber}</span>
        </p>
      </div>
      <TopBar proof={proof} canApprove={shown} />
      <ProofViewer proof={proof} onShown={setShown} />
    </div>
  );
}

function sentLine(proof: ProofToReview) {
  const waited = formatWaited(proof.sentAt);
  const sent = `Dikirim ${waited} lalu`;
  return proof.attempt > 1 ? `${sent} · unggahan ke-${proof.attempt}` : sent;
}

function TopBar({ proof, canApprove }: { proof: ProofToReview; canApprove: boolean }) {
  const [rejecting, setRejecting] = useState(false);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-3 border-y border-border py-3">
      <div className="grid">
        <span className="text-xs text-muted-foreground">Tagihan</span>
        <span className="text-xl font-semibold tracking-tight tabular-nums">
          {formatRupiah(proof.amountDue)}
        </span>
      </div>
      <div className="grid min-w-0 text-sm">
        <span className="text-xs text-muted-foreground">Wali</span>
        <span className="wrap-anywhere">{proof.guardianName}</span>
      </div>
      <span className="text-sm text-muted-foreground" title={formatShortDateTime(proof.sentAt)}>
        {sentLine(proof)}
      </span>
      <div className={cn("min-w-0", rejecting ? "basis-full" : "sm:ml-auto")}>
        <Actions
          proof={proof}
          canApprove={canApprove}
          rejecting={rejecting}
          setRejecting={setRejecting}
        />
      </div>
    </div>
  );
}

/**
 * `canApprove` is false while the proof has not rendered. Approving a payment
 * you were never shown is the one mistake this screen must not make easy.
 */
function Actions({
  proof,
  canApprove,
  rejecting,
  setRejecting,
}: {
  proof: ProofToReview;
  canApprove: boolean;
  rejecting: boolean;
  setRejecting: (value: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());

  const decide = useMutation({
    mutationFn: (input: { decision: "APPROVED" | "REJECTED"; reason?: string }) =>
      api.staff.payments.decide({ paymentId: proof.paymentId, idempotencyKey: key, ...input }),
    onSuccess: async () => {
      await next();
    },
    onError: (error) => {
      // A fresh key, so a retry after a network failure is a new decision.
      // An already-handled proof is not retried at all.
      if (!isHandled(error)) setKey(crypto.randomUUID());
    },
  });
  const handled = isHandled(decide.error);

  /**
   * Back to the queue, which opens the next proof on its own. Only the queue is
   * invalidated: `["payments"]` would also refetch the proof still on screen,
   * and asking for a proof records a staff view that nobody made.
   */
  async function next() {
    queryClient.removeQueries({ queryKey: ["payments", "proof", proof.paymentId] });
    await queryClient.invalidateQueries({ queryKey: ["payments", "waiting"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await navigate({ to: "/pembayaran", search: {}, replace: true });
  }

  if (!proof.canDecide) {
    return <Notice>Kamu bisa membaca bukti ini, tapi tidak memutuskannya.</Notice>;
  }
  // Someone else got there first. It stays on screen until the committee moves
  // on, so the answer is read rather than flashed past.
  if (handled) {
    return (
      <div className="grid gap-2">
        <Notice>Bukti ini sudah ditangani staf lain.</Notice>
        <Button variant="outline" size="sm" onClick={() => void next()}>
          Buka bukti berikutnya
        </Button>
      </div>
    );
  }

  if (rejecting) {
    return (
      <div className="grid gap-2">
        <div className="grid gap-1.5 text-sm">
          <label htmlFor={reasonId} className="font-medium">
            Alasan untuk keluarga
          </label>
          <Textarea
            id={reasonId}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Contoh: Nominalnya kurang Rp50.000. Transfer kekurangannya, lalu unggah bukti yang baru."
            className="field-sizing-content min-h-20 resize-none"
          />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MessageCircleIcon aria-hidden className="size-3 shrink-0" /> Keluarga membaca ini.
        </p>
        {decide.isError && <Failed />}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            size="sm"
            disabled={reason.trim().length === 0 || decide.isPending}
            focusableWhenDisabled
            onClick={() => decide.mutate({ decision: "REJECTED", reason: reason.trim() })}
          >
            {decide.isPending ? "Menolak…" : "Tolak bukti"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRejecting(false)}>
            Batal
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!canApprove || decide.isPending}
          focusableWhenDisabled
          onClick={() => decide.mutate({ decision: "APPROVED" })}
        >
          <CheckIcon aria-hidden /> {decide.isPending ? "Menyetujui…" : "Setujui"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setRejecting(true)}>
          <XIcon aria-hidden /> Tolak
        </Button>
      </div>
      {!canApprove && (
        <p className="text-xs text-pretty text-muted-foreground">
          Buktinya belum tampil, jadi Setujui dikunci. Buka berkasnya dulu.
        </p>
      )}
      {decide.isError && <Failed />}
    </div>
  );
}

function isHandled(error: unknown) {
  return error instanceof ORPCError && error.code === "ALREADY_HANDLED";
}

function Notice({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md bg-info-tint p-3 text-sm text-pretty text-info">
      <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function Failed() {
  return <p className="text-xs text-pretty text-destructive">Belum tersimpan. Coba lagi.</p>;
}

/**
 * The proof itself. Zoom and rotate are real state, because a photo taken
 * sideways is the common case and the nominal is unreadable until the committee
 * can turn it and enlarge it.
 */
function ProofViewer({
  proof,
  onShown,
}: {
  proof: ProofToReview;
  onShown: (shown: boolean) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState(0);
  const [failed, setFailed] = useState(false);

  if (proof.file.contentType === "application/pdf") {
    return <OpenFile proof={proof} onShown={onShown} note="PDF" />;
  }
  if (failed) {
    return (
      <OpenFile proof={proof} onShown={onShown} note="Gambarnya tidak bisa ditampilkan di sini." />
    );
  }
  return (
    <div className="relative grid min-w-0">
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Perkecil"
          onClick={() => setZoom(Math.max(1, zoom - 0.5))}
        >
          <ZoomOutIcon aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Perbesar"
          onClick={() => setZoom(Math.min(4, zoom + 0.5))}
        >
          <ZoomInIcon aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Putar"
          onClick={() => setTurn((turn + 90) % 360)}
        >
          <RotateCwIcon aria-hidden />
        </Button>
      </div>
      <div className="grid max-h-[32rem] min-w-0 place-items-center overflow-auto rounded-md border border-border bg-muted/40 p-3">
        <img
          data-proof
          src={proof.url}
          alt="Bukti transfer"
          onLoad={() => onShown(true)}
          onError={() => {
            setFailed(true);
            onShown(false);
          }}
          style={{ transform: `rotate(${turn}deg) scale(${zoom})` }}
          className="max-h-[30rem] w-auto rounded-md bg-white transition-transform"
        />
      </div>
    </div>
  );
}

/**
 * A PDF, or a photo this browser will not decode, such as an iPhone HEIC. It
 * opens in its own tab, and opening it is what unlocks Setujui: the committee
 * has seen the file by then.
 */
function OpenFile({
  proof,
  onShown,
  note,
}: {
  proof: ProofToReview;
  onShown: (shown: boolean) => void;
  note: string;
}) {
  return (
    <div className="grid min-w-0 place-items-center gap-3 rounded-md border border-border bg-muted/40 p-12 text-center">
      <FileTextIcon aria-hidden className="size-8 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 gap-0.5">
        <p className="text-sm font-medium">Bukti transfer</p>
        <p className="text-xs text-pretty text-muted-foreground tabular-nums">
          {formatBytes(proof.file.byteSize)} · {note}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          window.open(proof.url, "_blank", "noopener");
          onShown(true);
        }}
      >
        Buka berkas
      </Button>
    </div>
  );
}

const oneDecimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

function formatBytes(bytes: number) {
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${oneDecimal.format(mb)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
