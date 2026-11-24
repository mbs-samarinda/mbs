import { safe } from "@mbs/api-client/rpc";
import type { CheckedStatus, CheckStatusInput, FamilyStage } from "@mbs/api-contract";
import { APPLICANT_RULES } from "@mbs/api-contract/applicant-rules";
import { Alert } from "@mbs/ui/components/alert";
import { BrandMark } from "@mbs/ui/components/brand-mark";
import { Button, buttonVariants } from "@mbs/ui/components/button";
import { ThemeSelect } from "@mbs/ui/components/theme-select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useLocation, useRouter } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

import { accountQuery } from "../account.ts";
import { api } from "../api.ts";
import { APP_NAME } from "../app-name.ts";
import { explain } from "../email-code.ts";
import { EntryLayout } from "../entry-layout.tsx";
import { TextField } from "../field.tsx";
import { formatWait, schoolName } from "../format.ts";
import { STAGE_COPY } from "../stage-copy.ts";
import { ApplicationHeader, NextStep, Road } from "../status-parts.tsx";
import { useSingleFlight } from "../use-single-flight.ts";

declare module "@tanstack/react-router" {
  interface HistoryState {
    /**
     * Marks the page after the form, so that Back leads to the form. It is a random
     * id and holds no answer. A reload keeps the mark and loses the answer, so a
     * plain yes would fit the next answer to the wrong page.
     */
    checked?: string;
  }
}

export const Route = createFileRoute("/cek")({
  head: () => ({ meta: [{ title: "Cek status pendaftaran · Madina Boarding School" }] }),
  component: CheckStatus,
});

type Refusal = { result: "noMatch" } | { result: "wait"; seconds: number };

/**
 * The answer is kept in this component and nowhere else, so leaving the page,
 * going back and reloading all ask again.
 */
function CheckStatus() {
  const router = useRouter();
  const navigate = Route.useNavigate();
  const page = useLocation({ select: ({ state }) => state.checked });
  const [answer, setAnswer] = useState<{ page: string; status: CheckedStatus } | null>(null);
  if (answer && answer.page !== page) setAnswer(null);
  // Counts the times the page was left, so a typed NIK and a late answer go too.
  const visits = useRef(0);
  const [formKey, setFormKey] = useState(0);

  const check = useMutation({
    mutationFn: async (input: CheckStatusInput): Promise<Refusal | null> => {
      const visit = visits.current;
      const { error, data, isDefined } = await safe(api.public.application.checkStatus(input));
      if (isDefined && error.code === "NO_MATCH") return { result: "noMatch" };
      if (isDefined && error.code === "TOO_MANY_TRIES") {
        return { result: "wait", seconds: error.data.retryAfterSeconds };
      }
      if (error) throw error;
      // The visitor may have left while this was on its way. Asked of the route and
      // not of the path, which can also be spelled `/cek/`.
      const here = router.state.matches.some(({ routeId }) => routeId === Route.id);
      if (!here || visit !== visits.current) return null;
      const next = crypto.randomUUID();
      await navigate({ to: "/cek", state: { checked: next } });
      setAnswer({ page: next, status: data });
      return null;
    },
    // It remembers what was typed, the NIK too.
    gcTime: 0,
  });

  // A browser can keep a page it left in memory and show it again as it was.
  useEffect(() => {
    const forget = () => {
      visits.current += 1;
      flushSync(() => {
        setAnswer(null);
        setFormKey(visits.current);
      });
    };
    addEventListener("pagehide", forget);
    return () => removeEventListener("pagehide", forget);
  }, []);

  // The path stays the same, so the router does not move focus to the new screen.
  const answered = answer !== null;
  const wasAnswered = useRef(false);
  useEffect(() => {
    if (answered !== wasAnswered.current) document.querySelector("h1")?.focus();
    wasAnswered.current = answered;
  }, [answered]);

  const checkOnce = useSingleFlight(check);
  const problem = check.error
    ? explain(check.error).message
    : check.data
      ? refusalCopy(check.data)
      : null;
  return answer ? (
    <Result status={answer.status} onBack={() => router.history.back()} />
  ) : (
    <EntryLayout>
      <Form
        key={formKey}
        onCheck={checkOnce}
        // What the server said was about what was sent, not what is typed now.
        onEdit={() => {
          if (!check.isPending) check.reset();
        }}
        pending={check.isPending}
        problem={problem}
      />
    </EntryLayout>
  );
}

function refusalCopy(refusal: Refusal) {
  return refusal.result === "noMatch"
    ? "Nomor pendaftaran dan NIK belum cocok. Periksa lagi keduanya."
    : `Terlalu banyak percobaan. Tunggu ${formatWait(refusal.seconds)}, lalu coba lagi.`;
}

const EMPTY: CheckStatusInput = { registrationNumber: "", nik: "" };

function Form({
  onCheck,
  onEdit,
  pending,
  problem,
}: {
  onCheck: (input: CheckStatusInput) => void;
  onEdit: () => void;
  pending: boolean;
  problem: string | null;
}) {
  const [values, setValues] = useState(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [announced, setAnnounced] = useState("");
  const errors = errorsIn(values);
  const shown = submitted ? errors : {};

  const edit = (changes: Partial<CheckStatusInput>) => {
    setValues({ ...values, ...changes });
    onEdit();
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const first = errors.registrationNumber ? "registrationNumber" : errors.nik ? "nik" : null;
    if (!first) {
      setAnnounced("");
      return onCheck(values);
    }
    flushSync(() => {
      setSubmitted(true);
      setAnnounced(`Ada ${Object.keys(errors).length} isian yang perlu diperbaiki.`);
    });
    document.getElementById(first)?.focus();
  };

  return (
    <>
      <div className="grid gap-2">
        <h1 tabIndex={-1} className="text-2xl font-semibold text-balance outline-none">
          Cek status pendaftaran
        </h1>
        <p className="text-pretty text-muted-foreground">
          Kamu hanya melihat. Untuk membayar atau mengirim dokumen,{" "}
          <Link to="/masuk" className="font-medium text-primary underline underline-offset-4">
            masuk dulu
          </Link>
          .
        </p>
      </div>
      {/* Post, so that a submit the script never saw could not put the NIK in the URL. */}
      <form method="post" noValidate onSubmit={submit} className="grid grid-cols-1 gap-5">
        <p role="alert" className="sr-only">
          {announced}
        </p>
        <TextField
          field="registrationNumber"
          label="Nomor pendaftaran"
          error={shown.registrationNumber}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="cth. SMP-0042"
          value={values.registrationNumber}
          onChange={({ target }) => edit({ registrationNumber: target.value })}
        />
        <TextField
          field="nik"
          label="NIK anak"
          hint="16 angka, ada di kartu keluarga."
          error={shown.nik}
          autoComplete="off"
          inputMode="numeric"
          spellCheck={false}
          placeholder="cth. 6472 0209 0714 0003"
          value={values.nik}
          onChange={({ target }) => edit({ nik: target.value })}
        />
        {problem && Object.keys(shown).length === 0 && <Alert>{problem}</Alert>}
        <Button type="submit" size="touch" disabled={pending} focusableWhenDisabled>
          {pending ? "Memeriksa…" : "Lihat status"}
        </Button>
      </form>
    </>
  );
}

/** Only what any number and NIK must be. The server never says which of the two was wrong. */
function errorsIn({ registrationNumber, nik }: CheckStatusInput) {
  const errors: { registrationNumber?: string; nik?: string } = {};
  if (registrationNumber.trim() === "") {
    errors.registrationNumber = "Isi nomor pendaftaran, misalnya SMP-0042.";
  }
  const read = APPLICANT_RULES.nik(nik);
  if (!read.ok) errors.nik = read.message;
  return errors;
}

const TURNS = {
  FAMILY: "Giliran keluarga",
  COMMITTEE: "Giliran panitia",
  NOBODY: "Selesai",
} as const;

function Result({ status, onBack }: { status: CheckedStatus; onBack: () => void }) {
  const { data: account } = useQuery(accountQuery);
  const { turn, title } = STAGE_COPY[status.stage];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-[min(1.25rem,6vw)]">
      <header className="flex flex-wrap items-center gap-2 py-5">
        <div className="min-w-0 flex-1 basis-48">
          <BrandMark sub={APP_NAME} />
        </div>
        <ThemeSelect size="touch" className="-mr-[min(0.75rem,6vw)] ml-auto" />
      </header>
      <main className="grid flex-1 grid-cols-1 content-start gap-8 pt-4 pb-10">
        <button
          type="button"
          onClick={onBack}
          className="-mb-4 inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          Cek nomor lain
        </button>
        <ApplicationHeader application={status} />
        <NextStep turn={TURNS[turn]} title={title}>
          <p className="text-pretty">{NEXT[status.stage](status)}</p>
        </NextStep>
        <Road stage={status.stage} finished={status.finished} />
        <Link
          to={account ? "/" : "/masuk"}
          className={cn(
            buttonVariants({ variant: "outline", size: "touch" }),
            "justify-self-start",
          )}
        >
          {account ? "Buka halaman utama" : "Masuk"}
        </Link>
      </main>
    </div>
  );
}

const wait = ({ childName }: CheckedStatus) =>
  `Tidak ada yang perlu dilakukan dulu. Kabar berikutnya dikirim lewat email ke akun yang mendaftarkan ${childName}.`;

/** For a relative who only looks, so it says what the account holder does, never "kamu". */
const NEXT: Record<FamilyStage, (status: CheckedStatus) => string> = {
  PAYMENT_DUE: ({ childName }) =>
    `Langkah pembayaran ada di akun yang mendaftarkan ${childName}. Jangan transfer sebelum melihatnya di sana.`,
  PAYMENT_REVIEW: wait,
  DOCUMENTS_DUE: ({ childName }) => `Dokumen dikirim lewat akun yang mendaftarkan ${childName}.`,
  DOCUMENTS_REVIEW: wait,
  SCREENING: wait,
  INTERVIEW_PENDING: ({ childName }) =>
    `Panitia sedang menyusun jadwalnya. Kabarnya dikirim lewat email ke akun yang mendaftarkan ${childName}.`,
  INTERVIEW_SCHEDULED: ({ childName }) =>
    `Waktu dan tempatnya akan muncul di akun yang mendaftarkan ${childName}.`,
  INTERVIEWED: () => "Wawancara sudah selesai. Hasilnya akan muncul di halaman ini.",
  REREGISTRATION: ({ childName, schoolKey }) =>
    `Selamat, ${childName} diterima di ${schoolName(schoolKey)}. Daftar ulang dilakukan lewat akun yang mendaftarkannya.`,
  REREGISTRATION_REVIEW: wait,
  ENROLLED: ({ childName, schoolKey }) =>
    `${childName} sudah resmi menjadi siswa ${schoolName(schoolKey)}.`,
  NOT_ADVANCED: ({ childName }) =>
    `Mohon maaf, pendaftaran ${childName} berhenti di seleksi berkas. Catatan panitia bisa dibaca lewat akun yang mendaftarkannya.`,
  NOT_ACCEPTED: ({ childName, schoolKey }) =>
    `Mohon maaf, ${childName} belum diterima di ${schoolName(schoolKey)}. Terima kasih sudah mendaftar.`,
  WITHDRAWN: ({ schoolKey }) =>
    `Kalau ada yang ingin ditanyakan, hubungi panitia PPDB ${schoolName(schoolKey)}.`,
};
