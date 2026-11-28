import { ORPCError } from "@mbs/api-client/rpc";
import type { PaymentPage } from "@mbs/api-contract";
import { Button } from "@mbs/ui/components/button";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  CameraIcon,
  CopyIcon,
  FileTextIcon,
  ImageIcon,
  UploadIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { api, paymentQuery } from "../api.ts";
import { formatBytes, formatFee } from "../format.ts";
import { BAD_TYPE, prepare, putToBucket, TOO_BIG, type ChosenFile } from "../upload.ts";

export const Route = createFileRoute("/_app/bayar/$applicationId")({
  loader: async ({ context: { queryClient, account }, params }) => {
    try {
      await queryClient.ensureQueryData(paymentQuery(account.id, params.applicationId));
    } catch (error) {
      if (error instanceof ORPCError && ["NOT_FOUND", "BAD_REQUEST"].includes(error.code)) {
        throw notFound();
      }
      throw error;
    }
  },
  head: () => ({ meta: [{ title: "Pembayaran · Madina Boarding School" }] }),
  component: Pay,
});

function Pay() {
  const { account } = Route.useRouteContext();
  const { applicationId } = Route.useParams();
  const navigate = useNavigate();
  const { data: payment } = useSuspenseQuery({
    ...paymentQuery(account.id, applicationId),
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (payment.stage !== "PAYMENT_DUE") {
      void navigate({ to: "/status/$applicationId", params: { applicationId }, replace: true });
    }
  }, [payment.stage, applicationId, navigate]);

  const rejected = payment.attempts.find((attempt) => attempt.decision === "REJECTED");
  return (
    <>
      <Link
        to="/status/$applicationId"
        params={{ applicationId }}
        className="-mb-4 inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        Status pendaftaran
      </Link>
      <div className="grid gap-1">
        <h1 tabIndex={-1} className="text-xl font-semibold outline-none">
          Pembayaran
        </h1>
        <p className="text-sm wrap-anywhere text-muted-foreground">{payment.childName}</p>
        <p className="text-sm text-muted-foreground tabular-nums">
          Nomor pendaftaran{" "}
          <span className="font-medium text-foreground">{payment.registrationNumber}</span>
        </p>
      </div>
      {rejected?.reason && <Rejected reason={rejected.reason} />}
      <Part number="Pertama" title="Transfer">
        <Account payment={payment} />
      </Part>
      <Part number="Kedua" title="Unggah bukti">
        <Upload applicationId={applicationId} accountId={account.id} />
      </Part>
    </>
  );
}

function Rejected({ reason }: { reason: string }) {
  return (
    <div className="grid gap-1 rounded-xl bg-warning-tint p-[min(1.25rem,6vw)] text-pretty text-warning">
      <p className="font-medium">Bukti transfer perlu diunggah ulang</p>
      <Reason text={reason} />
    </div>
  );
}

function Reason({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 180;
  return (
    <div className="grid justify-items-start gap-1">
      <p className={cn("whitespace-pre-line", long && !open && "line-clamp-4")}>
        Catatan panitia: {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="min-h-11 text-sm font-medium underline underline-offset-4"
        >
          {open ? "Ringkas lagi" : "Selengkapnya"}
        </button>
      )}
    </div>
  );
}

function Part({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium text-info">{number}</span>
        <span className="text-lg font-semibold">{title}</span>
      </h2>
      {children}
    </section>
  );
}

function Account({ payment }: { payment: PaymentPage }) {
  if (!payment.account) {
    return (
      <p className="rounded-xl bg-warning-tint p-[min(1.25rem,6vw)] text-pretty text-warning">
        Rekening tujuan belum diisi panitia. Hubungi panitia sebelum transfer.
      </p>
    );
  }
  const { bankName, accountNumber, accountHolder } = payment.account;
  return (
    <div className="grid rounded-xl border border-border bg-background px-3.5">
      <CopyRow
        label="Jumlah"
        shown={formatFee(payment.amountDue)}
        copied={String(payment.amountDue)}
        big
      />
      <CopyRow label="Nomor rekening" shown={accountNumber} copied={digitsOnly(accountNumber)} />
      <div className="grid gap-0.5 border-b border-border/70 py-2.5 last:border-b-0">
        <p className="text-xs text-muted-foreground">Bank</p>
        <p className="font-medium">{bankName}</p>
      </div>
      <div className="grid gap-0.5 py-2.5">
        <p className="text-xs text-muted-foreground">Atas nama</p>
        <p className="font-medium text-pretty">{accountHolder}</p>
      </div>
    </div>
  );
}

/** Only the digits, because a bank app refuses the spaces the schema allows. */
const digitsOnly = (value: string) => value.replaceAll(/\D/g, "");

function CopyRow({
  label,
  shown,
  copied,
  big,
}: {
  label: string;
  shown: string;
  copied: string;
  big?: boolean;
}) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-border/70 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-[1_1_8rem]">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            "min-w-0 font-medium tabular-nums",
            big ? "text-2xl font-semibold tracking-tight max-[28rem]:text-xl" : "wrap-anywhere",
          )}
        >
          {shown}
        </p>
      </div>
      <Button
        variant="outline"
        size="touch"
        aria-label={`Salin ${label.toLowerCase()} ${copied}`}
        onClick={() => {
          void navigator.clipboard.writeText(copied).then(() => setDone(true));
        }}
        className="shrink-0 px-3"
      >
        <CopyIcon aria-hidden /> {done ? "Tersalin" : "Salin"}
      </Button>
    </div>
  );
}

const UPLOAD_HINT = "Foto atau PDF dari aplikasi bank kamu. Paling besar 10 MB.";

function Upload({ applicationId, accountId }: { applicationId: string; accountId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<{ file: ChosenFile; name: string; url: string } | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());

  const send = useMutation({
    mutationFn: async (file: ChosenFile) => {
      const signed = await api.applicant.payments.beginUpload({
        applicationId,
        contentType: file.contentType,
        byteSize: file.byteSize,
        sha256: file.sha256,
      });
      await putToBucket(signed.uploadUrl, file);
      await api.applicant.payments.sendProof({
        applicationId,
        token: signed.token,
        idempotencyKey: key,
      });
    },
    onSuccess: async () => {
      await done();
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: ["payments", accountId] }),
  });

  async function done() {
    await queryClient.invalidateQueries({ queryKey: ["applications", accountId] });
    await navigate({ to: "/status/$applicationId", params: { applicationId } });
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    const ready = await prepare(file);
    if (ready === TOO_BIG) {
      setProblem("Berkasnya lebih dari 10 MB. Coba foto ulang atau pilih berkas yang lebih kecil.");
      return;
    }
    if (ready === BAD_TYPE) {
      setProblem("Kirim foto atau PDF saja.");
      return;
    }
    setKey(crypto.randomUUID());
    setChosen((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { file: ready, name: file.name, url: URL.createObjectURL(ready.blob) };
    });
  }

  return (
    <div className="grid gap-3">
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => void choose(event.target.files?.[0])}
      />
      <input
        ref={picker}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        className="sr-only"
        onChange={(event) => void choose(event.target.files?.[0])}
      />
      {chosen ? (
        <div className="flex min-w-0 items-start gap-3 rounded-xl border border-border p-3">
          <Thumb url={chosen.url} />
          <div className="grid min-w-0 gap-1">
            <p className="text-sm font-medium wrap-anywhere">{chosen.name}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatBytes(chosen.file.byteSize)}
            </p>
            <button
              type="button"
              onClick={() => picker.current?.click()}
              className="min-h-11 w-fit text-sm text-primary underline-offset-4 hover:underline"
            >
              Ganti
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid justify-items-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-8 text-center">
            <ImageIcon aria-hidden className="size-7 text-muted-foreground" />
            <p className="text-sm text-pretty text-muted-foreground">{UPLOAD_HINT}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="touch"
              className="justify-center"
              onClick={() => camera.current?.click()}
            >
              <CameraIcon aria-hidden /> Foto
            </Button>
            <Button
              variant="outline"
              size="touch"
              className="justify-center"
              onClick={() => picker.current?.click()}
            >
              <UploadIcon aria-hidden /> Pilih berkas
            </Button>
          </div>
        </>
      )}
      {problem && <p className="text-sm text-pretty text-destructive">{problem}</p>}
      {send.isError && (
        <p className="text-sm text-pretty text-destructive">
          Bukti transfer belum terkirim. Coba lagi.
        </p>
      )}
      <Button
        size="touch"
        disabled={!chosen || send.isPending}
        focusableWhenDisabled
        className="w-full justify-center"
        onClick={() => {
          if (chosen) send.mutate(chosen.file);
        }}
      >
        {send.isPending ? "Mengirim…" : "Kirim bukti"}
      </Button>
    </div>
  );
}

function Thumb({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="grid h-28 w-20 shrink-0 place-items-center rounded-lg border border-border bg-muted">
        <FileTextIcon aria-hidden className="size-7 text-muted-foreground" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt="Bukti transfer yang kamu pilih"
      onError={() => setFailed(true)}
      className="h-28 w-20 shrink-0 rounded-lg border border-border bg-white object-cover object-top"
    />
  );
}
