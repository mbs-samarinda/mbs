import { ORPCError } from "@mbs/api-client/rpc";
import {
  CreateCycleInput,
  SaveCycleInput,
  SETUP_GAPS,
  type AdmissionCycle,
  type ChangeValue,
  type CycleChange,
  type CycleField,
  type CycleSection,
  type CycleSetup,
  type CycleStatus,
  type DocumentRequirement,
  type SchoolSetup,
  type SetupGap,
} from "@mbs/api-contract";
import { DOCUMENT_TYPES, type SchoolKey } from "@mbs/school-config";
import { Alert } from "@mbs/ui/components/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@mbs/ui/components/alert-dialog";
import { Button } from "@mbs/ui/components/button";
import { Calendar } from "@mbs/ui/components/calendar";
import { Checkbox } from "@mbs/ui/components/checkbox";
import { Input } from "@mbs/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@mbs/ui/components/input-group";
import { NativeSelect, NativeSelectOption } from "@mbs/ui/components/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@mbs/ui/components/popover";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@mbs/ui/components/sheet";
import { Textarea } from "@mbs/ui/components/textarea";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleDashedIcon,
} from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { DOCUMENT_LABELS, Field, SchoolMark, schoolShortName } from "../committee-ui.tsx";
import { formatRupiah, formatShortDateTime, formatStamp, fromWita, toWita } from "../format.ts";
import {
  agreementVersionsQuery,
  api,
  cycleSetupQuery,
  cyclesQuery,
  issuesByField,
  serverIssues,
} from "../staff.ts";

export const Route = createFileRoute("/_app/pengaturan/periode")({
  validateSearch: (search: Record<string, unknown>): { periode?: string | undefined } => ({
    periode: typeof search.periode === "string" ? search.periode : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const cycles = await context.queryClient.ensureQueryData(cyclesQuery);
    const id = pickCycle(cycles, deps.periode)?.id;
    if (id) await context.queryClient.ensureQueryData(cycleSetupQuery(id));
  },
  head: () => ({ meta: [{ title: "Periode · Panitia PPDB" }] }),
  component: CyclePage,
});

/** The one asked for, else the open one, else the newest. */
function pickCycle(cycles: readonly AdmissionCycle[], wanted: string | undefined) {
  return (
    cycles.find((cycle) => cycle.id === wanted) ??
    cycles.find((cycle) => cycle.status === "OPEN") ??
    cycles[0]
  );
}

const STATUS_LABELS: Record<CycleStatus, string> = {
  DRAFT: "Draf",
  OPEN: "Dibuka",
  CLOSED: "Ditutup",
  ARCHIVED: "Diarsipkan",
};

const SECTION_TITLES: Record<CycleSection, string> = {
  schedule: "Jadwal",
  bank: "Rekening",
  fees: "Biaya",
  documents: "Dokumen",
  messages: "Pesan untuk keluarga",
  agreement: "Perjanjian",
};

/** The two groups follow the gap table: what blocks opening, and what can follow before results. */
const GROUPS: { title: string; sections: CycleSection[] }[] = [
  {
    title: "Wajib sebelum pendaftaran dibuka",
    sections: ["schedule", "bank", "fees", "documents"],
  },
  { title: "Bisa menyusul sebelum hasil diumumkan", sections: ["messages", "agreement"] },
];

const list = new Intl.ListFormat("id-ID", { type: "conjunction" });
const schoolList = (keys: readonly SchoolKey[]) => list.format(keys.map(schoolShortName));

function CyclePage() {
  const { periode } = Route.useSearch();
  const { data: cycles } = useSuspenseQuery(cyclesQuery);
  const [creating, setCreating] = useState(false);
  const chosen = pickCycle(cycles, periode);

  const newCycle = (
    <Sheet open={creating} onOpenChange={setCreating}>
      <SheetContent className="data-[side=right]:sm:max-w-lg">
        {creating && <NewCycleForm from={cycles[0]} onDone={() => setCreating(false)} />}
      </SheetContent>
    </Sheet>
  );

  if (!chosen) {
    return (
      <div className="grid content-start justify-items-start gap-3 p-[min(2rem,5vw)]">
        <h1 tabIndex={-1} className="text-2xl font-semibold outline-none">
          Periode
        </h1>
        <p className="text-sm text-muted-foreground">Belum ada periode pendaftaran.</p>
        <Button onClick={() => setCreating(true)}>Buat periode</Button>
        {newCycle}
      </div>
    );
  }
  return (
    <>
      <CycleRecord
        key={chosen.id}
        cycleId={chosen.id}
        cycles={cycles}
        onNew={() => setCreating(true)}
      />
      {newCycle}
    </>
  );
}

function CycleRecord({
  cycleId,
  cycles,
  onNew,
}: {
  cycleId: string;
  cycles: readonly AdmissionCycle[];
  onNew: () => void;
}) {
  const { data: setup } = useSuspenseQuery(cycleSetupQuery(cycleId));
  const [editing, setEditing] = useState<CycleSection | null>(null);
  const { cycle } = setup;
  const editable = cycle.status !== "ARCHIVED";
  const left = new Set(setup.gaps.map((gap) => SETUP_GAPS[gap.kind].section)).size;

  return (
    <div className="grid content-start">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-[min(2rem,5vw)] pb-6">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden
            className="grid size-14 shrink-0 place-items-center rounded-md bg-muted text-lg font-semibold text-muted-foreground"
          >
            {yearMark(cycle)}
          </span>
          <div className="grid min-w-0 gap-1">
            <h1
              tabIndex={-1}
              className="text-2xl font-semibold text-balance wrap-anywhere outline-none"
            >
              {cycle.name}
            </h1>
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <span>{STATUS_LABELS[cycle.status]}</span>
              {left > 0 && editable && (
                <>
                  <span aria-hidden>·</span>
                  <span>{left} bagian belum lengkap</span>
                </>
              )}
              <span aria-hidden>·</span>
              <CycleSwitcher cycles={cycles} current={cycle.id} />
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={onNew}
                className="hover:text-foreground hover:underline"
              >
                Periode baru
              </button>
            </p>
          </div>
        </div>
        <StatusAction setup={setup} cycles={cycles} />
      </header>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid content-start gap-8 p-[min(2rem,5vw)]">
          {!editable && (
            <p className="text-sm text-muted-foreground">
              Periode ini sudah diarsipkan. Isinya tidak bisa diubah lagi.
            </p>
          )}
          {GROUPS.map((group) => (
            <section key={group.title} className="grid gap-1">
              <h2 className="text-xs font-medium text-muted-foreground">{group.title}</h2>
              <ul className="grid">
                {group.sections.map((section) => (
                  <ChecklistRow
                    key={section}
                    section={section}
                    setup={setup}
                    onEdit={editable ? () => setEditing(section) : undefined}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
        <History history={setup.history} />
      </div>
      <Sheet open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <SheetContent className="data-[side=right]:sm:max-w-lg">
          {editing && (
            <SectionForm section={editing} setup={setup} onDone={() => setEditing(null)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** "27" for PPDB 2027/2028: the year families know the cycle by. */
function yearMark(cycle: AdmissionCycle) {
  const year = /\d{4}/.exec(cycle.name)?.[0] ?? toWita(cycle.registrationOpenAt).day.slice(0, 4);
  return year.slice(2);
}

function CycleSwitcher({
  cycles,
  current,
}: {
  cycles: readonly AdmissionCycle[];
  current: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex items-center gap-0.5 hover:text-foreground hover:underline">
        Periode lain <ChevronDownIcon aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-1">
        <ul className="grid max-h-80 overflow-y-auto">
          {cycles.map((cycle) => (
            <li key={cycle.id}>
              <Link
                to="/pengaturan/periode"
                search={{ periode: cycle.id }}
                onClick={() => setOpen(false)}
                aria-current={cycle.id === current ? "page" : undefined}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted aria-[current=page]:font-medium"
              >
                <span className="min-w-0 truncate" title={cycle.name}>
                  {cycle.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {STATUS_LABELS[cycle.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

const NEXT: Partial<
  Record<CycleStatus, { to: CycleStatus; label: string; title: string; body: string }>
> = {
  DRAFT: {
    to: "OPEN",
    label: "Buka pendaftaran",
    title: "Buka pendaftaran?",
    body: "Keluarga bisa mendaftar sesuai jadwal. Periode yang sudah dibuka tidak bisa kembali ke draf.",
  },
  OPEN: {
    to: "CLOSED",
    label: "Tutup pendaftaran",
    title: "Tutup pendaftaran?",
    body: "Keluarga tidak bisa mendaftar lagi di periode ini. Panitia tetap bisa memeriksa pendaftar.",
  },
  CLOSED: {
    to: "ARCHIVED",
    label: "Arsipkan",
    title: "Arsipkan periode ini?",
    body: "Pengaturan periode ini tidak bisa diubah lagi. Riwayat pendaftar tetap ada.",
  },
};

const GAP_NAMES: Record<SetupGap["kind"], string> = {
  schedule: "jadwal",
  bank: "rekening",
  registrationDocuments: "dokumen pendaftaran",
  reregistrationFee: "biaya daftar ulang",
  reregistrationDocuments: "dokumen daftar ulang",
  acceptedInstructions: "pesan diterima",
  rejectedInstructions: "pesan tidak diterima",
  agreement: "perjanjian",
};

function StatusAction({ setup, cycles }: { setup: CycleSetup; cycles: readonly AdmissionCycle[] }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const { cycle } = setup;
  const next = NEXT[cycle.status];

  const move = useMutation({
    mutationFn: (status: CycleStatus) => api.admin.cycles.setStatus({ cycleId: cycle.id, status }),
    onSuccess: () => {
      setConfirming(false);
      return queryClient.invalidateQueries({ queryKey: ["cycles"] });
    },
    onError: () => setConfirming(false),
  });

  if (!next) return null;
  const otherOpen = cycles.find((each) => each.status === "OPEN" && each.id !== cycle.id);
  const blocking = setup.gaps.filter((gap) => SETUP_GAPS[gap.kind].neededToOpen);
  const reason =
    next.to !== "OPEN"
      ? null
      : otherOpen
        ? `${otherOpen.name} masih dibuka. Tutup dulu sebelum membuka periode ini.`
        : blocking.length > 0
          ? `Lengkapi ${list.format([...new Set(blocking.map((gap) => GAP_NAMES[gap.kind]))])} dulu.`
          : null;
  const refused = move.error ? refusal(move.error) : null;

  return (
    <div className="grid max-w-xs justify-items-end gap-1 text-right">
      <Button
        variant={next.to === "OPEN" ? "default" : "outline"}
        disabled={reason !== null || move.isPending}
        focusableWhenDisabled
        onClick={() => setConfirming(true)}
      >
        {next.label}
      </Button>
      {(refused ?? reason) && (
        <p
          className={cn(
            "text-xs text-pretty",
            refused ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {refused ?? reason}
        </p>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{next.title}</AlertDialogTitle>
            <AlertDialogDescription>{next.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction disabled={move.isPending} onClick={() => move.mutate(next.to)}>
              {next.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function refusal(error: Error) {
  if (error instanceof ORPCError && error.code === "ANOTHER_CYCLE_OPEN") {
    return "Satu periode lain masih dibuka. Tutup dulu periode itu.";
  }
  if (error instanceof ORPCError && error.code === "NOT_READY") {
    return "Ada bagian wajib yang belum lengkap. Muat ulang halaman untuk melihatnya.";
  }
  return "Status belum berubah. Coba lagi sebentar lagi.";
}

type RowState = "done" | "blocking" | "later";

function ChecklistRow({
  section,
  setup,
  onEdit,
}: {
  section: CycleSection;
  setup: CycleSetup;
  onEdit: (() => void) | undefined;
}) {
  const gaps = setup.gaps.filter((gap) => SETUP_GAPS[gap.kind].section === section);
  const state: RowState =
    gaps.length === 0
      ? "done"
      : gaps.some((gap) => SETUP_GAPS[gap.kind].neededToOpen)
        ? "blocking"
        : "later";
  return (
    <li className="flex items-start gap-3 border-b border-border py-4">
      {state === "done" && (
        <CheckIcon aria-label="Lengkap" className="mt-0.5 size-4 shrink-0 text-success" />
      )}
      {state === "blocking" && (
        <CircleAlertIcon
          aria-label="Wajib dilengkapi"
          className="mt-0.5 size-4 shrink-0 text-warning"
        />
      )}
      {state === "later" && (
        <CircleDashedIcon
          aria-label="Bisa menyusul"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
      )}
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-medium">{SECTION_TITLES[section]}</span>
        <span className="text-sm text-pretty wrap-anywhere text-muted-foreground">
          {SUMMARIES[section](setup, gaps)}
        </span>
      </div>
      {onEdit && (
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          aria-label={`Ubah ${SECTION_TITLES[section].toLowerCase()}`}
        >
          Ubah
        </Button>
      )}
    </li>
  );
}

const missingAt = (gaps: readonly SetupGap[], kind: SetupGap["kind"]) =>
  gaps.flatMap((gap) => (gap.kind === kind && gap.schoolKey ? [gap.schoolKey] : []));

const taking = (setup: CycleSetup) => setup.schools.filter((school) => school.isEnabled);

/** One sentence per row, naming what is missing first. */
const SUMMARIES: Record<CycleSection, (setup: CycleSetup, gaps: SetupGap[]) => string> = {
  schedule: ({ cycle, schools }) => {
    const off = schools.filter((school) => !school.isEnabled).map((school) => school.schoolKey);
    return [
      `${formatShortDateTime(cycle.registrationOpenAt)} sampai ${formatShortDateTime(cycle.registrationCloseAt)}.`,
      `Hasil ${formatShortDateTime(cycle.resultPublishAt)} WITA.`,
      off.length > 0 ? `${schoolList(off)} tidak ikut.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  },
  bank: ({ cycle }) =>
    cycle.bank
      ? `${cycle.bank.bankName} ${cycle.bank.accountNumber} a.n. ${cycle.bank.accountHolder}`
      : "Belum diisi. Keluarga mentransfer biaya ke rekening ini.",
  fees: (setup, gaps) => {
    const schools = taking(setup);
    const fees = new Set(schools.map((school) => school.effectiveFee));
    const registration =
      fees.size === 1
        ? `Pendaftaran ${formatRupiah([...fees][0]!)}.`
        : `Pendaftaran ${schools.map((school) => `${schoolShortName(school.schoolKey)} ${formatRupiah(school.effectiveFee)}`).join(", ")}.`;
    const missing = missingAt(gaps, "reregistrationFee");
    return `${registration} ${missing.length > 0 ? `Daftar ulang ${schoolList(missing)} belum diisi.` : "Daftar ulang sudah diisi."}`;
  },
  documents: (setup, gaps) => {
    const missing = missingAt(gaps, "registrationDocuments");
    const later = missingAt(gaps, "reregistrationDocuments");
    const required = DOCUMENT_TYPES.filter((type) =>
      taking(setup).some((school) =>
        school.registrationDocuments.some(
          (document) => document.type === type && document.required,
        ),
      ),
    );
    return [
      missing.length > 0
        ? `${schoolList(missing)} belum punya dokumen pendaftaran.`
        : required.length > 0
          ? `Wajib saat mendaftar: ${list.format(required.map((type) => DOCUMENT_LABELS[type]))}.`
          : "Dokumen pendaftaran sudah diatur.",
      later.length > 0
        ? `Daftar ulang ${schoolList(later)} belum diisi.`
        : "Daftar ulang sudah diatur.",
    ].join(" ");
  },
  messages: (_, gaps) => {
    const accepted = missingAt(gaps, "acceptedInstructions");
    const rejected = missingAt(gaps, "rejectedInstructions");
    if (accepted.length === 0 && rejected.length === 0) {
      return "Pesan diterima dan tidak diterima sudah ada.";
    }
    return [
      accepted.length > 0 ? `${schoolList(accepted)} belum punya pesan diterima.` : "",
      rejected.length > 0 ? `${schoolList(rejected)} belum punya pesan tidak diterima.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  },
  agreement: (setup, gaps) => {
    const missing = missingAt(gaps, "agreement");
    const versions = taking(setup).flatMap((school) =>
      school.agreement
        ? [`${schoolShortName(school.schoolKey)} versi ${school.agreement.version}`]
        : [],
    );
    return [
      missing.length > 0
        ? `${schoolList(missing)} belum punya perjanjian. Baru diminta saat daftar ulang.`
        : "",
      versions.length > 0 && missing.length === 0 ? `${list.format(versions)}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  },
};

type FieldWords = { label: string; value?: (value: ChangeValue) => string };

const text = (value: ChangeValue) => (typeof value === "string" ? value : "Belum ada");
const money = (empty: string) => (value: ChangeValue) =>
  typeof value === "number" ? formatRupiah(value) : empty;
const moment = (value: ChangeValue) =>
  typeof value === "string" ? formatShortDateTime(value) : "Belum ada";
const documentList = (value: ChangeValue) => {
  if (!Array.isArray(value) || value.length === 0) return "Tidak ada";
  return list.format(
    value.map(({ type, required }: DocumentRequirement) =>
      required ? DOCUMENT_LABELS[type] : `${DOCUMENT_LABELS[type]} (opsional)`,
    ),
  );
};

/** Words for each field the history can name. Long texts show only that they changed. */
const FIELDS: Record<CycleField, FieldWords> = {
  name: { label: "Nama periode", value: text },
  status: {
    label: "Status",
    value: (value) => (isStatus(value) ? STATUS_LABELS[value] : "Belum ada"),
  },
  registrationOpenAt: { label: "Tanggal buka", value: moment },
  registrationCloseAt: { label: "Tanggal tutup", value: moment },
  resultPublishAt: { label: "Tanggal pengumuman", value: moment },
  defaultFee: { label: "Biaya pendaftaran bawaan", value: money("Belum ada") },
  bankName: { label: "Nama bank", value: text },
  bankAccountNumber: { label: "Nomor rekening", value: text },
  bankAccountHolder: { label: "Pemilik rekening", value: text },
  isEnabled: { label: "Keikutsertaan", value: (value) => (value ? "Ikut" : "Tidak ikut") },
  fee: { label: "Biaya pendaftaran", value: money("Bawaan") },
  reregistrationFee: { label: "Biaya daftar ulang", value: money("Belum diisi") },
  registrationDocuments: { label: "Dokumen pendaftaran", value: documentList },
  reregistrationDocuments: { label: "Dokumen daftar ulang", value: documentList },
  acceptedInstructions: { label: "Pesan diterima" },
  rejectedInstructions: { label: "Pesan tidak diterima" },
  agreement: {
    label: "Perjanjian",
    value: (value) => (typeof value === "number" ? `Versi ${value}` : "Belum ada"),
  },
};

const isStatus = (value: ChangeValue): value is CycleStatus =>
  typeof value === "string" && value in STATUS_LABELS;

const STATUS_VERBS: Partial<Record<CycleStatus, string>> = {
  OPEN: "membuka pendaftaran",
  CLOSED: "menutup pendaftaran",
  ARCHIVED: "mengarsipkan periode ini",
};

type HistoryLine = { key: string; who: string; what: string; values: string | null; at: string };

function historyLines(change: CycleChange): HistoryLine[] {
  const who = change.who ?? "Sistem";
  const line = (key: string, what: string, values: string | null = null) => ({
    key: `${change.id}:${key}`,
    who,
    what,
    values,
    at: change.at,
  });
  if (change.created) return [line("created", "membuat periode ini")];
  if (change.changes.length === 0) return [line("changed", "mengubah periode ini")];
  return change.changes.map((each, index) => {
    if (each.field === "status") {
      return line(String(index), (isStatus(each.to) && STATUS_VERBS[each.to]) || "mengubah status");
    }
    const words = FIELDS[each.field];
    const school = each.schoolKey ? ` ${schoolShortName(each.schoolKey)}` : "";
    return line(
      String(index),
      `mengubah ${words.label.toLowerCase()}${school}`,
      words.value ? `${words.value(each.from)} → ${words.value(each.to)}` : null,
    );
  });
}

function History({ history }: { history: CycleChange[] }) {
  const lines = history.flatMap(historyLines);
  return (
    <aside className="grid content-start gap-4 border-t border-border p-[min(2rem,5vw)] lg:border-t-0 lg:border-l">
      <h2 className="text-sm font-semibold">Riwayat perubahan</h2>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada perubahan.</p>
      ) : (
        <ol className="grid gap-4 text-sm">
          {lines.map((line) => (
            <li key={line.key} className="grid gap-0.5">
              <span className="wrap-anywhere">
                <span className="font-medium">{line.who}</span> {line.what}
              </span>
              {line.values && (
                <span className="text-pretty wrap-anywhere text-muted-foreground">
                  {line.values}
                </span>
              )}
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatStamp(line.at)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

/* Side panels. Each edits a copy and saves its own section, checked first against the contract. */

function useSave(cycleId: string, onDone: () => void) {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: (input: SaveCycleInput) => api.admin.cycles.save(input),
    onSuccess: (setup) => {
      queryClient.setQueryData(cycleSetupQuery(cycleId).queryKey, setup);
      void queryClient.invalidateQueries({ queryKey: cyclesQuery.queryKey });
      onDone();
    },
    onError: (error) => {
      const issues = serverIssues(error);
      if (issues) setErrors(issuesByField(issues));
    },
  });

  /** Checks the input with the contract's own rules, then saves. Local errors win. */
  function submit(input: unknown, local: Record<string, string> = {}) {
    const parsed = SaveCycleInput.safeParse(input);
    const found = { ...(parsed.success ? {} : issuesByField(parsed.error.issues)), ...local };
    setErrors(found);
    if (Object.keys(found).length === 0 && parsed.success) mutation.mutate(parsed.data);
  }

  const failed = mutation.error && !serverIssues(mutation.error) && (
    <Alert>
      {mutation.error instanceof ORPCError && mutation.error.code === "CONFLICT"
        ? "Periode ini tidak bisa diubah lagi, atau baru saja diubah orang lain. Muat ulang halaman."
        : "Perubahan belum tersimpan. Coba lagi sebentar lagi."}
    </Alert>
  );
  return { submit, errors, pending: mutation.isPending, failed };
}

function SectionForm({
  section,
  setup,
  onDone,
}: {
  section: CycleSection;
  setup: CycleSetup;
  onDone: () => void;
}) {
  const props = { setup, onDone };
  if (section === "schedule") return <ScheduleForm {...props} />;
  if (section === "bank") return <BankForm {...props} />;
  if (section === "fees") return <FeesForm {...props} />;
  if (section === "documents") return <DocumentsForm {...props} />;
  if (section === "messages") return <MessagesForm {...props} />;
  return <AgreementForm {...props} />;
}

function Panel({
  title,
  onSubmit,
  onCancel,
  pending,
  action = "Simpan",
  children,
}: {
  title: string;
  onSubmit: () => void;
  onCancel: () => void;
  pending: boolean;
  action?: string;
  children: ReactNode;
}) {
  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
      </SheetHeader>
      <div className="grid flex-1 content-start gap-5 overflow-y-auto px-4 pb-4">{children}</div>
      <SheetFooter className="flex-row justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" disabled={pending} focusableWhenDisabled>
          {pending ? "Menyimpan…" : action}
        </Button>
      </SheetFooter>
    </form>
  );
}

function SchoolHeading({ school }: { school: SchoolKey }) {
  return (
    <h3 className="text-sm font-medium">
      <SchoolMark school={school} />
    </h3>
  );
}

type FormProps = { setup: CycleSetup; onDone: () => void };

/** A Samarinda day picked on a calendar, and a clock time typed beside it. */
function DateTime({
  label,
  hint,
  error,
  value,
  onChange,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  value: { day: string; time: string };
  onChange: (value: { day: string; time: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [year, month, date] = value.day.split("-").map(Number);
  const selected = year && month && date ? new Date(year, month - 1, date) : undefined;
  return (
    <div className="grid min-w-0 content-start gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                aria-label={`${label}, tanggal`}
                aria-invalid={error ? true : undefined}
                className="min-w-0 flex-1 justify-start font-normal"
              />
            }
          >
            <CalendarIcon aria-hidden className="text-muted-foreground" />
            <span className="truncate">
              {selected ? dayFormat.format(selected) : "Pilih tanggal"}
            </span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              {...(selected ? { selected, defaultMonth: selected } : {})}
              weekStartsOn={1}
              formatters={CALENDAR_WORDS}
              labels={CALENDAR_LABELS}
              onSelect={(day) => {
                if (!day) return;
                onChange({
                  ...value,
                  day: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
                });
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <Input
          value={value.time}
          onChange={(event) => onChange({ ...value, time: event.target.value })}
          aria-label={`${label}, jam`}
          aria-invalid={error ? true : undefined}
          inputMode="numeric"
          placeholder="08.00"
          className="w-20 tabular-nums"
        />
      </div>
      {error ? (
        <span className="text-xs text-pretty text-destructive">{error}</span>
      ) : (
        hint && <span className="text-xs text-pretty text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

const pad = (number: number) => String(number).padStart(2, "0");

const dayFormat = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const monthFormat = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" });
const weekdayFormat = new Intl.DateTimeFormat("id-ID", { weekday: "short" });
const CALENDAR_WORDS = {
  formatCaption: (month: Date) => monthFormat.format(month),
  formatWeekdayName: (weekday: Date) => weekdayFormat.format(weekday),
};
const CALENDAR_LABELS = {
  labelNext: () => "Bulan berikutnya",
  labelPrevious: () => "Bulan sebelumnya",
};

type Moments = Record<
  "registrationOpenAt" | "registrationCloseAt" | "resultPublishAt",
  { day: string; time: string }
>;

const MOMENT_FIELDS = [
  ["registrationOpenAt", "Pendaftaran dibuka", undefined],
  ["registrationCloseAt", "Pendaftaran ditutup", undefined],
  ["resultPublishAt", "Hasil diumumkan", "Keluarga melihat hasil mulai jam ini."],
] as const;

/** Turns the typed times into instants, and names any time that is not a real one. */
function readMoments(moments: Moments) {
  const local: Record<string, string> = {};
  const values: Partial<Record<keyof Moments, string>> = {};
  for (const [key] of MOMENT_FIELDS) {
    const iso = fromWita(moments[key].day, moments[key].time);
    if (iso) values[key] = iso;
    else local[key] = "Pilih tanggal, lalu tulis jam seperti 08.00.";
  }
  return { values, local };
}

function MomentFields({
  moments,
  setMoments,
  errors,
}: {
  moments: Moments;
  setMoments: (moments: Moments) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="grid gap-4">
      {MOMENT_FIELDS.map(([key, label, hint]) => (
        <DateTime
          key={key}
          label={label}
          hint={hint}
          error={errors[key]}
          value={moments[key]}
          onChange={(value) => setMoments({ ...moments, [key]: value })}
        />
      ))}
      <p className="text-xs text-muted-foreground">Semua jam dalam WITA.</p>
    </div>
  );
}

function ScheduleForm({ setup, onDone }: FormProps) {
  const { cycle } = setup;
  const save = useSave(cycle.id, onDone);
  const [name, setName] = useState(cycle.name);
  const [moments, setMoments] = useState<Moments>({
    registrationOpenAt: toWita(cycle.registrationOpenAt),
    registrationCloseAt: toWita(cycle.registrationCloseAt),
    resultPublishAt: toWita(cycle.resultPublishAt),
  });
  const id = useId();
  const [enabled, setEnabled] = useState(
    Object.fromEntries(setup.schools.map((school) => [school.schoolKey, school.isEnabled])),
  );

  return (
    <Panel
      title="Jadwal"
      pending={save.pending}
      onCancel={onDone}
      onSubmit={() => {
        const { values, local } = readMoments(moments);
        save.submit(
          {
            section: "schedule",
            cycleId: cycle.id,
            name,
            ...values,
            schools: setup.schools.map(({ schoolKey }) => ({
              schoolKey,
              isEnabled: enabled[schoolKey] ?? true,
            })),
          },
          { ...local, ...(name.trim() ? {} : { name: "Isi nama periode." }) },
        );
      }}
    >
      <Field label="Nama periode" error={save.errors.name}>
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
      </Field>
      <MomentFields moments={moments} setMoments={setMoments} errors={save.errors} />
      <fieldset className="grid gap-2 text-sm">
        <legend className="pb-1.5 font-medium">Sekolah yang ikut</legend>
        {setup.schools.map(({ schoolKey }) => (
          <label key={schoolKey} htmlFor={`${id}-${schoolKey}`} className="flex items-center gap-2">
            <Checkbox
              id={`${id}-${schoolKey}`}
              checked={enabled[schoolKey] ?? true}
              onCheckedChange={(checked) => setEnabled({ ...enabled, [schoolKey]: checked })}
            />
            <SchoolMark school={schoolKey} />
          </label>
        ))}
        <span className="text-xs text-pretty text-muted-foreground">
          Sekolah yang tidak ikut tidak menerima pendaftar di periode ini.
        </span>
      </fieldset>
      {save.failed}
    </Panel>
  );
}

function BankForm({ setup, onDone }: FormProps) {
  const { cycle } = setup;
  const save = useSave(cycle.id, onDone);
  const [bank, setBank] = useState(
    cycle.bank ?? { bankName: "", accountNumber: "", accountHolder: "" },
  );
  const errorAt = (key: keyof typeof bank) =>
    save.errors[`bank.${key}`] &&
    (key === "accountNumber" && bank.accountNumber.trim()
      ? "Tulis nomor rekening dengan angka saja."
      : "Isi bagian ini.");

  return (
    <Panel
      title="Rekening"
      pending={save.pending}
      onCancel={onDone}
      onSubmit={() => save.submit({ section: "bank", cycleId: cycle.id, bank })}
    >
      <p className="text-sm text-pretty text-muted-foreground">
        Satu rekening untuk semua sekolah. Keluarga mentransfer biaya ke sini.
      </p>
      <Field label="Bank" error={errorAt("bankName")}>
        <Input
          value={bank.bankName}
          onChange={(event) => setBank({ ...bank, bankName: event.target.value })}
          maxLength={80}
        />
      </Field>
      <Field label="Nomor rekening" error={errorAt("accountNumber")}>
        <Input
          value={bank.accountNumber}
          onChange={(event) => setBank({ ...bank, accountNumber: event.target.value })}
          inputMode="numeric"
          maxLength={40}
          className="tabular-nums"
        />
      </Field>
      <Field label="Atas nama" error={errorAt("accountHolder")}>
        <Input
          value={bank.accountHolder}
          onChange={(event) => setBank({ ...bank, accountHolder: event.target.value })}
          maxLength={120}
        />
      </Field>
      {save.failed}
    </Panel>
  );
}

const grouping = new Intl.NumberFormat("id-ID");

/** Rupiah typed as digits and shown with dots. Empty is null, which each field explains. */
function Money({
  label,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>Rp</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        inputMode="numeric"
        value={value === null ? "" : grouping.format(value)}
        placeholder={placeholder}
        className="tabular-nums"
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, 10);
          onChange(digits ? Number(digits) : null);
        }}
      />
    </InputGroup>
  );
}

function FeesForm({ setup, onDone }: FormProps) {
  const { cycle } = setup;
  const save = useSave(cycle.id, onDone);
  const [defaultFee, setDefaultFee] = useState<number | null>(cycle.defaultFee);
  const [fees, setFees] = useState(
    setup.schools.map(({ schoolKey, feeOverride, reregistrationFee }) => ({
      schoolKey,
      feeOverride,
      reregistrationFee,
    })),
  );
  const update = (index: number, change: Partial<(typeof fees)[number]>) =>
    setFees(fees.map((fee, i) => (i === index ? { ...fee, ...change } : fee)));

  return (
    <Panel
      title="Biaya"
      pending={save.pending}
      onCancel={onDone}
      onSubmit={() =>
        save.submit(
          { section: "fees", cycleId: cycle.id, defaultFee, schools: fees },
          defaultFee === null ? { defaultFee: "Isi biaya bawaan. Boleh 0." } : {},
        )
      }
    >
      <Field
        label="Biaya pendaftaran bawaan"
        hint="Dipakai sekolah yang biaya pendaftarannya kosong."
        error={save.errors.defaultFee}
      >
        <Money
          label="Biaya pendaftaran bawaan"
          value={defaultFee}
          onChange={setDefaultFee}
          invalid={Boolean(save.errors.defaultFee)}
        />
      </Field>
      {fees.map((fee, index) => (
        <div key={fee.schoolKey} className="grid gap-3 border-t border-border pt-4">
          <SchoolHeading school={fee.schoolKey} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pendaftaran" error={save.errors[`schools.${index}.feeOverride`]}>
              <Money
                label={`Biaya pendaftaran ${schoolShortName(fee.schoolKey)}`}
                value={fee.feeOverride}
                placeholder={defaultFee === null ? "" : grouping.format(defaultFee)}
                onChange={(feeOverride) => update(index, { feeOverride })}
              />
            </Field>
            <Field label="Daftar ulang" error={save.errors[`schools.${index}.reregistrationFee`]}>
              <Money
                label={`Biaya daftar ulang ${schoolShortName(fee.schoolKey)}`}
                value={fee.reregistrationFee}
                placeholder="Belum diisi"
                onChange={(reregistrationFee) => update(index, { reregistrationFee })}
              />
            </Field>
          </div>
        </div>
      ))}
      <p className="text-xs text-pretty text-muted-foreground">
        Pendaftar yang sudah ada tetap membayar biaya saat mereka mendaftar.
      </p>
      {save.failed}
    </Panel>
  );
}

const NEEDS = ["required", "optional", "none"] as const;
type Need = (typeof NEEDS)[number];

const needOf = (
  documents: readonly DocumentRequirement[],
  type: DocumentRequirement["type"],
): Need => {
  const found = documents.find((document) => document.type === type);
  return found ? (found.required ? "required" : "optional") : "none";
};

const fromNeeds = (needs: ReadonlyMap<DocumentRequirement["type"], Need>): DocumentRequirement[] =>
  DOCUMENT_TYPES.flatMap((type) => {
    const need = needs.get(type) ?? "none";
    return need === "none" ? [] : [{ type, required: need === "required" }];
  });

const needsOf = (required: readonly DocumentRequirement[]) =>
  new Map(DOCUMENT_TYPES.map((type) => [type, needOf(required, type)]));

function NeedSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Need;
  onChange: (value: Need) => void;
}) {
  return (
    <NativeSelect
      aria-label={label}
      value={value}
      onChange={(event) => {
        const next = NEEDS.find((need) => need === event.target.value);
        if (next) onChange(next);
      }}
      className="w-full"
    >
      <NativeSelectOption value="required">Wajib</NativeSelectOption>
      <NativeSelectOption value="optional">Opsional</NativeSelectOption>
      <NativeSelectOption value="none">Tidak diminta</NativeSelectOption>
    </NativeSelect>
  );
}

function DocumentsForm({ setup, onDone }: FormProps) {
  const { cycle } = setup;
  const save = useSave(cycle.id, onDone);
  const [needs, setNeeds] = useState(
    setup.schools.map((school) => ({
      schoolKey: school.schoolKey,
      registration: needsOf(school.registrationDocuments),
      reregistration: needsOf(school.reregistrationDocuments),
    })),
  );
  const set = (
    index: number,
    stage: "registration" | "reregistration",
    type: DocumentRequirement["type"],
    need: Need,
  ) =>
    setNeeds(
      needs.map((school, i) =>
        i === index ? { ...school, [stage]: new Map(school[stage]).set(type, need) } : school,
      ),
    );

  return (
    <Panel
      title="Dokumen"
      pending={save.pending}
      onCancel={onDone}
      onSubmit={() =>
        save.submit({
          section: "documents",
          cycleId: cycle.id,
          schools: needs.map((school) => ({
            schoolKey: school.schoolKey,
            registration: fromNeeds(school.registration),
            reregistration: fromNeeds(school.reregistration),
          })),
        })
      }
    >
      <p className="text-sm text-pretty text-muted-foreground">
        Halaman pendaftaran sekolah hanya menampilkan dokumen saat mendaftar.
      </p>
      {needs.map((school, index) => (
        <div key={school.schoolKey} className="grid gap-3 border-t border-border pt-4">
          <SchoolHeading school={school.schoolKey} />
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <span className="text-xs text-muted-foreground">Saat mendaftar</span>
            <span className="text-xs text-muted-foreground">Saat daftar ulang</span>
            {DOCUMENT_TYPES.map((type) => (
              <div key={type} className="col-span-2 grid grid-cols-subgrid gap-y-1">
                <span className="col-span-2 font-medium">{DOCUMENT_LABELS[type]}</span>
                <NeedSelect
                  label={`${DOCUMENT_LABELS[type]} saat mendaftar, ${schoolShortName(school.schoolKey)}`}
                  value={school.registration.get(type) ?? "none"}
                  onChange={(need) => set(index, "registration", type, need)}
                />
                <NeedSelect
                  label={`${DOCUMENT_LABELS[type]} saat daftar ulang, ${schoolShortName(school.schoolKey)}`}
                  value={school.reregistration.get(type) ?? "none"}
                  onChange={(need) => set(index, "reregistration", type, need)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      {save.failed}
    </Panel>
  );
}

function MessagesForm({ setup, onDone }: FormProps) {
  const { cycle } = setup;
  const save = useSave(cycle.id, onDone);
  const [messages, setMessages] = useState(
    setup.schools.map(({ schoolKey, acceptedInstructions, rejectedInstructions }) => ({
      schoolKey,
      acceptedInstructions: acceptedInstructions ?? "",
      rejectedInstructions: rejectedInstructions ?? "",
    })),
  );
  const update = (index: number, change: Partial<(typeof messages)[number]>) =>
    setMessages(messages.map((message, i) => (i === index ? { ...message, ...change } : message)));

  return (
    <Panel
      title="Pesan untuk keluarga"
      pending={save.pending}
      onCancel={onDone}
      onSubmit={() =>
        save.submit({
          section: "messages",
          cycleId: cycle.id,
          schools: messages.map((message) => ({
            schoolKey: message.schoolKey,
            acceptedInstructions: message.acceptedInstructions.trim() || null,
            rejectedInstructions: message.rejectedInstructions.trim() || null,
          })),
        })
      }
    >
      <p className="text-sm text-pretty text-muted-foreground">
        Keluarga membaca pesan ini bersama hasil seleksi.
      </p>
      {messages.map((message, index) => (
        <div key={message.schoolKey} className="grid gap-3 border-t border-border pt-4">
          <SchoolHeading school={message.schoolKey} />
          <Field
            label="Untuk yang diterima"
            error={save.errors[`schools.${index}.acceptedInstructions`]}
          >
            <Textarea
              rows={3}
              maxLength={2000}
              value={message.acceptedInstructions}
              onChange={(event) => update(index, { acceptedInstructions: event.target.value })}
            />
          </Field>
          <Field
            label="Untuk yang tidak diterima"
            error={save.errors[`schools.${index}.rejectedInstructions`]}
          >
            <Textarea
              rows={3}
              maxLength={2000}
              value={message.rejectedInstructions}
              onChange={(event) => update(index, { rejectedInstructions: event.target.value })}
            />
          </Field>
        </div>
      ))}
      {save.failed}
    </Panel>
  );
}

function AgreementForm({ setup, onDone }: FormProps) {
  const { cycle } = setup;
  const save = useSave(cycle.id, onDone);
  const [bodies, setBodies] = useState(
    Object.fromEntries(
      setup.schools.map((school) => [school.schoolKey, school.agreement?.body ?? ""]),
    ),
  );

  return (
    <Panel
      title="Perjanjian"
      pending={save.pending}
      onCancel={onDone}
      onSubmit={() =>
        save.submit({
          section: "agreement",
          cycleId: cycle.id,
          schools: setup.schools.flatMap(({ schoolKey }) => {
            const body = bodies[schoolKey]?.trim() ?? "";
            return body ? [{ schoolKey, body }] : [];
          }),
        })
      }
    >
      <p className="text-sm text-pretty text-muted-foreground">
        Keluarga menyetujui perjanjian ini saat daftar ulang. Teks baru menjadi versi baru, dan
        perjanjian ini terbawa ke periode berikutnya.
      </p>
      {setup.schools.map((school) => (
        <div key={school.schoolKey} className="grid gap-2 border-t border-border pt-4">
          <SchoolHeading school={school.schoolKey} />
          <Textarea
            rows={6}
            maxLength={20_000}
            aria-label={`Perjanjian ${schoolShortName(school.schoolKey)}`}
            value={bodies[school.schoolKey] ?? ""}
            placeholder="Belum ada perjanjian."
            onChange={(event) => setBodies({ ...bodies, [school.schoolKey]: event.target.value })}
          />
          <AgreementNote school={school} />
        </div>
      ))}
      {save.failed}
    </Panel>
  );
}

function AgreementNote({ school }: { school: SchoolSetup }) {
  const [showing, setShowing] = useState(false);
  const versions = useQuery({ ...agreementVersionsQuery(school.schoolKey), enabled: showing });
  const { agreement } = school;
  if (!agreement) return null;
  return (
    <div className="grid gap-2 text-xs text-muted-foreground">
      <span className="wrap-anywhere">
        Versi {agreement.version}, disimpan {formatShortDateTime(agreement.createdAt)} WITA oleh{" "}
        {agreement.createdBy}.{" "}
        {school.agreementVersions > 1 && (
          <button
            type="button"
            aria-expanded={showing}
            onClick={() => setShowing(!showing)}
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            {showing ? "Tutup versi lama" : "Lihat versi lama"}
          </button>
        )}
      </span>
      {showing && (
        <ol className="grid max-h-72 gap-3 overflow-y-auto border-l border-border pl-3">
          {versions.isPending && <li>Memuat…</li>}
          {versions.isError && <li>Versi lama gagal dimuat. Coba lagi sebentar lagi.</li>}
          {versions.data
            ?.filter((version) => version.id !== agreement.id)
            .map((version) => (
              <li key={version.id} className="grid gap-1">
                <span>
                  Versi {version.version}, {formatShortDateTime(version.createdAt)} WITA oleh{" "}
                  {version.createdBy}
                </span>
                <p className="text-sm wrap-anywhere whitespace-pre-line text-foreground">
                  {version.body}
                </p>
              </li>
            ))}
        </ol>
      )}
    </div>
  );
}

/** Next year's name, if the name carries years: PPDB 2027/2028 becomes PPDB 2028/2029. */
const nextName = (name: string) =>
  /\d{4}/.test(name) ? name.replace(/\d{4}/g, (year) => String(Number(year) + 1)) : "";

/** The same moment a year later, on Samarinda's calendar. 29 February becomes the 28th. */
function nextYear(iso: string) {
  const { day, time } = toWita(iso);
  const [year, rest] = [Number(day.slice(0, 4)) + 1, day.slice(4)];
  const leap = rest === "-02-29" && new Date(year, 1, 29).getMonth() !== 1;
  return { day: `${year}${leap ? "-02-28" : rest}`, time };
}

function NewCycleForm({ from, onDone }: { from: AdmissionCycle | undefined; onDone: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(from ? nextName(from.name) : "");
  const [defaultFee, setDefaultFee] = useState<number | null>(from?.defaultFee ?? null);
  const [moments, setMoments] = useState<Moments>(
    from
      ? {
          registrationOpenAt: nextYear(from.registrationOpenAt),
          registrationCloseAt: nextYear(from.registrationCloseAt),
          resultPublishAt: nextYear(from.resultPublishAt),
        }
      : {
          registrationOpenAt: { day: "", time: "08.00" },
          registrationCloseAt: { day: "", time: "23.59" },
          resultPublishAt: { day: "", time: "10.00" },
        },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (input: CreateCycleInput) => api.admin.cycles.create(input),
    onSuccess: async (cycle) => {
      await queryClient.invalidateQueries({ queryKey: cyclesQuery.queryKey });
      onDone();
      await navigate({ to: "/pengaturan/periode", search: { periode: cycle.id } });
    },
    onError: (error) => {
      const issues = serverIssues(error);
      if (issues) setErrors(issuesByField(issues));
    },
  });

  return (
    <Panel
      title="Periode baru"
      action="Buat periode"
      pending={create.isPending}
      onCancel={onDone}
      onSubmit={() => {
        const { values, local } = readMoments(moments);
        if (!name.trim()) local.name = "Isi nama periode.";
        if (defaultFee === null) local.defaultFee = "Isi biaya bawaan. Boleh 0.";
        const parsed = CreateCycleInput.safeParse({ name, defaultFee, ...values });
        const found = { ...(parsed.success ? {} : issuesByField(parsed.error.issues)), ...local };
        setErrors(found);
        if (Object.keys(found).length === 0 && parsed.success) create.mutate(parsed.data);
      }}
    >
      {from && (
        <p className="text-sm text-pretty text-muted-foreground">
          Rekening, biaya, dokumen dan pesan disalin dari {from.name}. Kamu bisa mengubahnya setelah
          ini.
        </p>
      )}
      <Field label="Nama periode" error={errors.name}>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          placeholder="PPDB 2028/2029"
        />
      </Field>
      <MomentFields moments={moments} setMoments={setMoments} errors={errors} />
      <Field label="Biaya pendaftaran bawaan" error={errors.defaultFee}>
        <Money label="Biaya pendaftaran bawaan" value={defaultFee} onChange={setDefaultFee} />
      </Field>
      {create.error && !serverIssues(create.error) && (
        <Alert>Periode belum dibuat. Coba lagi sebentar lagi.</Alert>
      )}
    </Panel>
  );
}
