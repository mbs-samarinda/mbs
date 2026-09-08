import { CreateCycleInput } from "@mbs/api-contract";
import type { AdmissionCycle, DocumentType, SchoolAdmissionSetting } from "@mbs/api-contract";
import { SCHOOLS, type SchoolKey } from "@mbs/school-config";
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
import { Badge } from "@mbs/ui/components/badge";
import { Button } from "@mbs/ui/components/button";
import { Calendar } from "@mbs/ui/components/calendar";
import { Checkbox } from "@mbs/ui/components/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@mbs/ui/components/dialog";
import { Input } from "@mbs/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@mbs/ui/components/input-group";
import { Label } from "@mbs/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@mbs/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mbs/ui/components/select";
import { Textarea } from "@mbs/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { CalendarIcon } from "lucide-react";
import {
  Fragment,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { api } from "../../api.ts";
import { formatRupiah, reformatRupiah } from "../../lib/rupiah.ts";

export const Route = createFileRoute("/_authenticated/cycle")({
  // The API refuses every admin procedure to anyone else; this only keeps a
  // staff member from reaching a page of error messages.
  beforeLoad: ({ context }) => {
    if (context.staff.role !== "ADMINISTRATOR") throw redirect({ to: "/" });
  },
  // The selected cycle survives a refresh and can be sent to a colleague.
  // "new" is the create form rather than a second route.
  // Returns nothing rather than `{ cycle: undefined }`, so a plain `<Link
  // to="/cycle" />` does not have to name a search param it does not care about.
  validateSearch: (search: Record<string, unknown>): { cycle?: string | undefined } =>
    typeof search.cycle === "string" ? { cycle: search.cycle } : {},
  component: CycleSettings,
});

const STATUS: Record<
  AdmissionCycle["status"],
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  DRAFT: { label: "Draf", variant: "secondary" },
  OPEN: { label: "Dibuka", variant: "default" },
  CLOSED: { label: "Ditutup", variant: "outline" },
  ARCHIVED: { label: "Diarsipkan", variant: "outline" },
};

/** One step forward only, matching the domain service. */
const ADVANCE: Record<
  AdmissionCycle["status"],
  { to: AdmissionCycle["status"]; label: string } | null
> = {
  DRAFT: { to: "OPEN", label: "Buka pendaftaran" },
  OPEN: { to: "CLOSED", label: "Tutup pendaftaran" },
  CLOSED: { to: "ARCHIVED", label: "Arsipkan" },
  ARCHIVED: null,
};

const REQUIREMENTS = [
  { value: "none", label: "Tidak diminta" },
  { value: "optional", label: "Opsional" },
  { value: "required", label: "Wajib" },
] as const;

type Requirement = (typeof REQUIREMENTS)[number]["value"];

const DOCUMENTS: readonly { type: DocumentType; label: string }[] = [
  { type: "KARTU_KELUARGA", label: "Kartu Keluarga" },
  { type: "AKTA_KELAHIRAN", label: "Akta Kelahiran" },
  { type: "KARTU_IDENTITAS_ANAK", label: "Kartu Identitas Anak" },
  { type: "IJAZAH", label: "Ijazah" },
];

const SCHOOL_SHORT: Record<SchoolKey, string> = { smp: "SMP", smk: "SMK", sma: "SMA" };

const INCOMPLETE_HINT = "Nama dan biaya dasar harus diisi.";

/**
 * What still stops this cycle from being saved, or null when nothing does.
 *
 * The date ordering is not restated here — `CreateCycleInput` already owns it,
 * messages and all, so the form asks the contract rather than keeping a second
 * copy of the rule that can drift from it. Only the two empty-field cases are
 * local, because an empty fee coerces to a valid zero and the contract cannot
 * tell that apart from a deliberate free cycle.
 */
function cycleProblem(draft: CycleDraft): string | null {
  if (draft.name.trim() === "" || draft.defaultFee === "") return INCOMPLETE_HINT;

  const parsed = CreateCycleInput.safeParse({ ...draft, defaultFee: Number(draft.defaultFee) });
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Periksa kembali isian.");
}

// ---------------------------------------------------------------- page

function CycleSettings() {
  const { cycle: selected } = Route.useSearch();
  const navigate = Route.useNavigate();
  const cycles = useQuery(api.admin.cycles.list.queryOptions());

  if (cycles.isPending)
    return <Shell>{<p className="text-sm text-muted-foreground">Memuat…</p>}</Shell>;

  if (cycles.error) {
    return (
      <Shell>
        <ErrorNotice message={cycles.error.message} onRetry={() => void cycles.refetch()} />
      </Shell>
    );
  }

  const list = cycles.data;
  const current = list.find((entry) => entry.id === selected) ?? list[0];

  if (selected === "new" || !current) {
    return (
      <Shell>
        <CreateCycle
          canCancel={list.length > 0}
          onCancel={() => void navigate({ search: {} })}
          onCreated={(created) => void navigate({ search: { cycle: created.id } })}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cycle-select">Gelombang</Label>
          <Select
            value={current.id}
            onValueChange={(value) => {
              if (typeof value === "string") void navigate({ search: { cycle: value } });
            }}
          >
            <SelectTrigger id="cycle-select" className="w-56">
              <SelectValue>
                {(value: string) => list.find((entry) => entry.id === value)?.name ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {list.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name} · {STATUS[entry.status].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => void navigate({ search: { cycle: "new" } })}>
          Gelombang baru
        </Button>
      </div>

      {/* Keyed so switching cycles rebuilds the editor's draft state instead of
          leaving one cycle's unsaved edits sitting on another's fields. */}
      <CycleEditor key={current.id} cycle={current} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight text-balance">Gelombang penerimaan</h1>
      <p className="mt-1 text-sm text-pretty text-muted-foreground">
        Berlaku untuk seluruh MBSS. Perubahan di sini tidak mengubah pendaftaran yang sudah dibuat.
      </p>
      {children}
    </main>
  );
}

// ---------------------------------------------------------------- editor

function CycleEditor({ cycle }: { cycle: AdmissionCycle }) {
  const queryClient = useQueryClient();
  // Known before the settings query resolves, so the placeholder holds the
  // right number of columns instead of collapsing from three to one.
  const { staff } = Route.useRouteContext();
  const settings = useQuery(
    api.admin.schoolSettings.list.queryOptions({ input: { cycleId: cycle.id } }),
  );

  const readOnly = cycle.status === "ARCHIVED";
  const invalidate = () => queryClient.invalidateQueries({ queryKey: api.admin.key() });

  return (
    <>
      <section aria-labelledby="cycle-heading" className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
          <h2 id="cycle-heading" className="text-base font-medium">
            {cycle.name}
          </h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant={STATUS[cycle.status].variant}>{STATUS[cycle.status].label}</Badge>
            <AdvanceStatus cycle={cycle} onDone={invalidate} />
          </div>
        </div>
        {readOnly ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Gelombang yang diarsipkan hanya bisa dibaca.
          </p>
        ) : null}
        <CycleForm cycle={cycle} readOnly={readOnly} onSaved={invalidate} />
      </section>

      <section aria-labelledby="schools-heading" className="mt-10">
        <h2 id="schools-heading" className="border-b border-border pb-2 text-base font-medium">
          Pengaturan per sekolah
        </h2>
        {settings.isPending ? (
          <SchoolSettingsSkeleton schools={staff.schools} />
        ) : settings.error ? (
          <div className="mt-4">
            <ErrorNotice message={settings.error.message} onRetry={() => void settings.refetch()} />
          </div>
        ) : settings.data.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Tidak ada sekolah dalam jangkauan akun ini.
          </p>
        ) : (
          /* Bridges the swap from the skeleton. The skeleton already held the
             layout, so this is a content change rather than a jump. */
          <div className="opacity-100 transition-opacity duration-200 ease-out starting:opacity-0">
            <SchoolSettings
              cycle={cycle}
              settings={settings.data}
              readOnly={readOnly}
              onSaved={invalidate}
            />
          </div>
        )}
      </section>
    </>
  );
}

type CycleDraft = {
  name: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  resultPublishAt: string;
  defaultFee: string;
};

function CycleForm({
  cycle,
  readOnly,
  onSaved,
}: {
  cycle: AdmissionCycle;
  readOnly: boolean;
  onSaved: () => Promise<void>;
}) {
  const initial: CycleDraft = {
    name: cycle.name,
    registrationOpenAt: cycle.registrationOpenAt,
    registrationCloseAt: cycle.registrationCloseAt,
    resultPublishAt: cycle.resultPublishAt,
    defaultFee: String(cycle.defaultFee),
  };
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const update = useMutation(
    api.admin.cycles.update.mutationOptions({
      onSuccess: () => {
        setError(null);
        return onSaved();
      },
    }),
  );

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const problem = cycleProblem(draft);
  const set = (patch: Partial<CycleDraft>) => setDraft((current) => ({ ...current, ...patch }));

  /**
   * Reseed when the server's copy changes, for the same reasons the school
   * settings below do: without it a value the contract normalises — a trimmed
   * name, a leading zero dropped from a fee — leaves this form stuck dirty, and
   * a colleague's edit never reaches the fields before this one overwrites it.
   */
  const fromServer = JSON.stringify(initial);
  const [seededFrom, setSeededFrom] = useState(fromServer);
  if (seededFrom !== fromServer) {
    setSeededFrom(fromServer);
    setDraft(initial);
  }

  return (
    <form
      className="mt-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        update
          .mutateAsync({ cycleId: cycle.id, ...draft, defaultFee: Number(draft.defaultFee) })
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "Gagal menyimpan."),
          );
      }}
    >
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <CycleFieldset draft={draft} onChange={set} disabled={readOnly || update.isPending} />
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 text-sm text-destructive opacity-100 transition-opacity duration-150 ease-out starting:opacity-0"
        >
          {error}
        </p>
      ) : null}

      {readOnly ? null : (
        <div className="mt-5 flex items-center gap-3">
          <Button type="submit" disabled={!dirty || problem !== null || update.isPending}>
            {update.isPending ? "Menyimpan…" : "Simpan gelombang"}
          </Button>
          <span className="text-sm text-muted-foreground">
            {problem ?? (dirty ? "Belum disimpan" : null)}
          </span>
        </div>
      )}
    </form>
  );
}

/** The five cycle fields, shared by the editor and the create form. */
function CycleFieldset({
  draft,
  onChange,
  disabled,
}: {
  draft: CycleDraft;
  onChange: (patch: Partial<CycleDraft>) => void;
  disabled: boolean;
}) {
  return (
    <>
      <Field label="Nama gelombang">
        {(id) => (
          <Input
            id={id}
            value={draft.name}
            disabled={disabled}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        )}
      </Field>
      <Field label="Biaya dasar">
        {(id) => (
          <CurrencyInput
            id={id}
            value={draft.defaultFee}
            disabled={disabled}
            onChange={(defaultFee) => onChange({ defaultFee })}
          />
        )}
      </Field>
      <Field label="Pendaftaran dibuka">
        {(id) => (
          <DateTimeField
            id={id}
            value={draft.registrationOpenAt}
            disabled={disabled}
            onChange={(registrationOpenAt) => onChange({ registrationOpenAt })}
          />
        )}
      </Field>
      <Field label="Pendaftaran ditutup">
        {(id) => (
          <DateTimeField
            id={id}
            value={draft.registrationCloseAt}
            disabled={disabled}
            onChange={(registrationCloseAt) => onChange({ registrationCloseAt })}
          />
        )}
      </Field>
      <Field label="Hasil diumumkan" hint="Sama untuk semua sekolah.">
        {(id) => (
          <DateTimeField
            id={id}
            value={draft.resultPublishAt}
            disabled={disabled}
            onChange={(resultPublishAt) => onChange({ resultPublishAt })}
          />
        )}
      </Field>
    </>
  );
}

function CreateCycle({
  canCancel,
  onCancel,
  onCreated,
}: {
  canCancel: boolean;
  onCancel: () => void;
  onCreated: (cycle: AdmissionCycle) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CycleDraft>(() => {
    const open = new Date();
    open.setHours(8, 0, 0, 0);
    const close = new Date(open);
    close.setMonth(close.getMonth() + 2);
    const publish = new Date(close);
    publish.setDate(publish.getDate() + 14);

    return {
      name: "",
      registrationOpenAt: open.toISOString(),
      registrationCloseAt: close.toISOString(),
      resultPublishAt: publish.toISOString(),
      defaultFee: "",
    };
  });
  const [error, setError] = useState<string | null>(null);
  const problem = cycleProblem(draft);

  const create = useMutation(
    api.admin.cycles.create.mutationOptions({
      onSuccess: async (created) => {
        await queryClient.invalidateQueries({ queryKey: api.admin.key() });
        onCreated(created);
      },
    }),
  );

  return (
    <form
      className="mt-8"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        create
          .mutateAsync({ ...draft, defaultFee: Number(draft.defaultFee) })
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "Gagal membuat gelombang."),
          );
      }}
    >
      <h2 className="text-base font-medium">Gelombang baru</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Dibuat sebagai draf. Sekolah diatur setelah gelombang ada.
      </p>

      <div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <CycleFieldset
          draft={draft}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          disabled={create.isPending}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 text-sm text-destructive opacity-100 transition-opacity duration-150 ease-out starting:opacity-0"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex gap-2">
        <Button type="submit" disabled={create.isPending || problem !== null}>
          {create.isPending ? "Membuat…" : "Buat gelombang"}
        </Button>
        {canCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Batal
          </Button>
        ) : null}
        {problem ? (
          <span className="self-center text-sm text-muted-foreground">{problem}</span>
        ) : null}
      </div>
    </form>
  );
}

function AdvanceStatus({ cycle, onDone }: { cycle: AdmissionCycle; onDone: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const next = ADVANCE[cycle.status];

  const setStatus = useMutation(
    api.admin.cycles.setStatus.mutationOptions({
      onSuccess: () => {
        setConfirming(false);
        return onDone();
      },
    }),
  );

  if (!next) return null;

  const advance = () => setStatus.mutate({ cycleId: cycle.id, status: next.to });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={setStatus.isPending}
        // Archiving is the one step that cannot be undone; the rest are
        // ordinary operational moves and a dialog on each would be ceremony.
        onClick={() => (next.to === "ARCHIVED" ? setConfirming(true) : advance())}
      >
        {next.label}
      </Button>

      {setStatus.error ? (
        <p
          role="alert"
          className="basis-full text-sm text-destructive opacity-100 transition-opacity duration-150 ease-out starting:opacity-0"
        >
          {setStatus.error.message}
        </p>
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arsipkan {cycle.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Seluruh isi gelombang menjadi hanya-baca dan tidak bisa dibuka kembali.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="outline">Batal</Button>} />
            <AlertDialogAction
              render={
                <Button disabled={setStatus.isPending} onClick={advance}>
                  Arsipkan
                </Button>
              }
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------- schools

type SchoolDraft = {
  isEnabled: boolean;
  feeOverride: string;
  documents: Record<DocumentType, Requirement>;
  acceptedInstructions: string;
  rejectedInstructions: string;
};

/** Absent means the school does not collect it; present splits on `required`. */
function requirementFor(setting: SchoolAdmissionSetting, type: DocumentType): Requirement {
  const match = setting.documents.find((entry) => entry.type === type);
  if (!match) return "none";
  return match.required ? "required" : "optional";
}

function toDraft(setting: SchoolAdmissionSetting): SchoolDraft {
  return {
    isEnabled: setting.isEnabled,
    feeOverride: setting.feeOverride === null ? "" : String(setting.feeOverride),
    // Written out rather than built from a loop: this way TypeScript checks
    // that every document type is covered when a new one is added.
    documents: {
      KARTU_KELUARGA: requirementFor(setting, "KARTU_KELUARGA"),
      AKTA_KELAHIRAN: requirementFor(setting, "AKTA_KELAHIRAN"),
      KARTU_IDENTITAS_ANAK: requirementFor(setting, "KARTU_IDENTITAS_ANAK"),
      IJAZAH: requirementFor(setting, "IJAZAH"),
    },
    acceptedInstructions: setting.acceptedInstructions ?? "",
    rejectedInstructions: setting.rejectedInstructions ?? "",
  };
}

function SchoolSettings({
  cycle,
  settings,
  readOnly,
  onSaved,
}: {
  cycle: AdmissionCycle;
  settings: readonly SchoolAdmissionSetting[];
  readOnly: boolean;
  onSaved: () => Promise<void>;
}) {
  const initial: Record<string, SchoolDraft> = Object.fromEntries(
    settings.map((setting) => [setting.schoolKey, toDraft(setting)]),
  );

  const [drafts, setDrafts] = useState(initial);
  const [failed, setFailed] = useState<{ schools: SchoolKey[]; message: string } | null>(null);
  const wide = useMediaQuery("(min-width: 48rem)");

  /**
   * Reseed from the server whenever its copy actually changes.
   *
   * Without this the drafts are seeded once and never again, so anything the
   * server normalises — a trimmed instruction, a leading zero dropped from a
   * fee — leaves the school marked unsaved forever, and a colleague's change
   * arriving in a refetch stays invisible until this form overwrites it.
   *
   * A refetch that returns identical data does not reset anything, so ordinary
   * background refetching never discards what someone is part-way through
   * typing. When another administrator's edit does arrive it wins, which is
   * the safer of the two ways to lose an edit: theirs is already saved.
   */
  const fromServer = JSON.stringify(initial);
  const [seededFrom, setSeededFrom] = useState(fromServer);
  if (seededFrom !== fromServer) {
    setSeededFrom(fromServer);
    // Every school except one whose save just failed. A partial save refetches
    // the schools that succeeded, and reseeding wholesale would throw away the
    // failed school's unsaved edits — while the message below tells the user
    // those edits are still on screen.
    setDrafts((current) => {
      const kept = new Set<string>(failed?.schools ?? []);
      return Object.fromEntries(
        Object.entries(initial).map(([key, seed]) => [key, kept.has(key) ? current[key]! : seed]),
      );
    });
  }

  const keys = settings.map((setting) => setting.schoolKey);
  const dirty = keys.filter((key) => JSON.stringify(drafts[key]) !== JSON.stringify(initial[key]));

  const upsert = useMutation(api.admin.schoolSettings.upsert.mutationOptions());

  const set = (key: SchoolKey, patch: Partial<SchoolDraft>) =>
    setDrafts((current) => ({ ...current, [key]: { ...current[key]!, ...patch } }));

  /**
   * One call per school, because that is what the API takes. They are settled
   * rather than raced to a first rejection: a school that saved must not be
   * reported as unsaved just because another one failed.
   */
  const save = async () => {
    setFailed(null);
    const results = await Promise.allSettled(
      dirty.map((key) => upsert.mutateAsync(toInput(cycle.id, key, drafts[key]!))),
    );

    const rejected = dirty.filter((_, index) => results[index]?.status === "rejected");

    // Recorded before the refetch, not after: the reseed runs as soon as the
    // refetch lands and has to already know which school to leave alone.
    if (rejected.length > 0) {
      const first = results.find((result) => result.status === "rejected");
      setFailed({
        schools: rejected,
        message:
          first?.status === "rejected" && first.reason instanceof Error
            ? first.reason.message
            : "Gagal menyimpan.",
      });
    }

    await onSaved();
  };

  const cell = (key: SchoolKey) => ({
    draft: drafts[key]!,
    onChange: (patch: Partial<SchoolDraft>) => set(key, patch),
    disabled: readOnly || upsert.isPending,
  });

  return (
    <>
      {/* Below the breakpoint the matrix becomes one block per school. Three
          columns of selects cannot survive a phone, and a horizontal scroll
          hides the comparison the matrix exists for. */}
      {wide ? (
        <table className="mt-5 w-full border-collapse text-sm">
          <caption className="sr-only">Pengaturan setiap sekolah pada {cycle.name}</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="w-56 py-2 pe-4 text-start font-medium text-muted-foreground"
              >
                Pengaturan
              </th>
              {keys.map((key) => (
                <th key={key} scope="col" className="px-3 py-2 text-start font-medium">
                  <span className="block">{SCHOOL_SHORT[key]}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {drafts[key]?.isEnabled ? "Ikut gelombang" : "Tidak ikut"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <MatrixRow label="Ikut gelombang" keys={keys}>
              {(key) => <EnabledField schoolKey={key} {...cell(key)} />}
            </MatrixRow>

            <MatrixRow label="Biaya pendaftaran" keys={keys}>
              {(key) => (
                <FeeField schoolKey={key} defaultFee={cycle.defaultFee} compact {...cell(key)} />
              )}
            </MatrixRow>

            {DOCUMENTS.map((document) => (
              <MatrixRow key={document.type} label={document.label} keys={keys}>
                {(key) => <RequirementField schoolKey={key} document={document} {...cell(key)} />}
              </MatrixRow>
            ))}

            <MatrixRow label="Teks keputusan" keys={keys}>
              {(key) => <InstructionsDialog schoolKey={key} {...cell(key)} />}
            </MatrixRow>
          </tbody>
        </table>
      ) : (
        <div className="mt-5 flex flex-col gap-8">
          {keys.map((key) => (
            <div key={key}>
              <h3 className="text-sm font-medium">{schoolName(key)}</h3>
              <div className="mt-4 flex flex-col gap-5">
                <LabelledField label="Ikut gelombang">
                  <EnabledField schoolKey={key} {...cell(key)} />
                </LabelledField>
                <Field label="Biaya pendaftaran">
                  {(id) => (
                    <FeeField
                      id={id}
                      schoolKey={key}
                      defaultFee={cycle.defaultFee}
                      {...cell(key)}
                    />
                  )}
                </Field>
                {DOCUMENTS.map((document) => (
                  <Field key={document.type} label={document.label}>
                    {(id) => (
                      <RequirementField
                        id={id}
                        schoolKey={key}
                        document={document}
                        {...cell(key)}
                      />
                    )}
                  </Field>
                ))}
                <LabelledField label="Teks keputusan">
                  <InstructionsDialog schoolKey={key} {...cell(key)} />
                </LabelledField>
              </div>
            </div>
          ))}
        </div>
      )}

      {failed ? (
        <p
          role="alert"
          className="mt-4 text-sm text-destructive opacity-100 transition-opacity duration-150 ease-out starting:opacity-0"
        >
          Gagal menyimpan {failed.schools.map((key) => SCHOOL_SHORT[key]).join(", ")}:{" "}
          {failed.message} Perubahan yang belum tersimpan masih ada di layar.
        </p>
      ) : null}

      {readOnly ? null : (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button disabled={dirty.length === 0 || upsert.isPending} onClick={() => void save()}>
            {upsert.isPending ? "Menyimpan…" : "Simpan sekolah"}
          </Button>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {dirty.length === 0
              ? "Tidak ada perubahan"
              : `Belum disimpan: ${dirty.map((key) => SCHOOL_SHORT[key]).join(", ")}`}
          </p>
        </div>
      )}
    </>
  );
}

function toInput(cycleId: string, schoolKey: SchoolKey, draft: SchoolDraft) {
  return {
    cycleId,
    schoolKey,
    isEnabled: draft.isEnabled,
    feeOverride: draft.feeOverride === "" ? null : Number(draft.feeOverride),
    acceptedInstructions: draft.acceptedInstructions.trim() || null,
    rejectedInstructions: draft.rejectedInstructions.trim() || null,
    // "Tidak diminta" is the absence of a row, not a third stored value.
    documents: DOCUMENTS.filter((document) => draft.documents[document.type] !== "none").map(
      (document) => ({
        type: document.type,
        required: draft.documents[document.type] === "required",
      }),
    ),
  };
}

/**
 * Holds the matrix's shape while the settings load, so the real controls
 * replace it without the page jumping.
 *
 * The row labels and the school columns are compile-time facts, so they render
 * for real and only the values are placeholders — there is nothing to be
 * suspenseful about in text we already have. Deliberately static: CLAUDE.md
 * rules out continuously repainting motion, which is what a pulsing or
 * shimmering skeleton is.
 */
function SchoolSettingsSkeleton({ schools }: { schools: readonly SchoolKey[] }) {
  const wide = useMediaQuery("(min-width: 48rem)");
  const rows = [
    "Ikut gelombang",
    "Biaya pendaftaran",
    ...DOCUMENTS.map((document) => document.label),
    "Teks keputusan",
  ];

  return (
    <>
      {/* The placeholder is hidden from assistive technology, so the state it
          stands for has to be said out loud instead. */}
      <p className="sr-only">Memuat pengaturan sekolah…</p>

      {wide ? (
        // A grid rather than a table: the placeholder carries no data, so table
        // semantics would only be something to hide again. The column count
        // comes from the signed-in administrator's own schools, which is what
        // the loaded matrix will show.
        <div
          aria-hidden="true"
          className="mt-5 grid text-sm"
          // Inline because the column count is data. A Tailwind arbitrary value
          // would have to be a literal for the class to survive extraction.
          style={{ gridTemplateColumns: `14rem repeat(${schools.length}, minmax(0, 1fr))` }}
        >
          <span className="py-2 pe-4 font-medium text-muted-foreground">Pengaturan</span>
          {schools.map((key) => (
            <span key={key} className="px-3 py-2 font-medium">
              {SCHOOL_SHORT[key]}
            </span>
          ))}
          {rows.map((label) => (
            <Fragment key={label}>
              <span className="border-t border-border py-3.5 pe-4">{label}</span>
              {schools.map((key) => (
                <span key={key} className="border-t border-border px-3 py-3.5">
                  <span className="block h-8 rounded-lg bg-muted" />
                </span>
              ))}
            </Fragment>
          ))}
        </div>
      ) : (
        <div aria-hidden="true" className="mt-5 flex flex-col gap-8">
          {schools.map((key) => (
            <div key={key}>
              <h3 className="text-sm font-medium">{schoolName(key)}</h3>
              <div className="mt-4 flex flex-col gap-5">
                {rows.map((label) => (
                  <div key={label} className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="block h-8 rounded-lg bg-muted" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function MatrixRow({
  label,
  keys,
  children,
}: {
  label: string;
  keys: readonly SchoolKey[];
  children: (key: SchoolKey) => React.ReactNode;
}) {
  return (
    // 14px of vertical padding, not 10: the checkbox carries a -14px click
    // overlay, so tighter rows would let one row swallow the next row's clicks.
    <tr className="border-t border-border">
      <th scope="row" className="py-3.5 pe-4 text-start align-middle font-normal">
        {label}
      </th>
      {keys.map((key) => (
        <td key={key} className="px-3 py-3.5 align-middle">
          {children(key)}
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------- fields

type CellProps = {
  schoolKey: SchoolKey;
  draft: SchoolDraft;
  onChange: (patch: Partial<SchoolDraft>) => void;
  disabled: boolean;
};

function EnabledField({ schoolKey, draft, onChange, disabled }: CellProps) {
  return (
    <Label className="font-normal">
      <Checkbox
        checked={draft.isEnabled}
        disabled={disabled}
        onCheckedChange={(checked) => onChange({ isEnabled: checked })}
        aria-label={`Ikutkan ${SCHOOL_SHORT[schoolKey]} pada gelombang ini`}
      />
      {draft.isEnabled ? "Ya" : "Tidak"}
    </Label>
  );
}

function FeeField({
  id,
  schoolKey,
  draft,
  onChange,
  disabled,
  defaultFee,
  compact,
}: CellProps & { id?: string | undefined; defaultFee: number; compact?: boolean | undefined }) {
  return (
    <div className="flex flex-col gap-1">
      <CurrencyInput
        id={id}
        value={draft.feeOverride}
        disabled={disabled}
        className={compact ? "max-w-40" : undefined}
        placeholder={rupiah(String(defaultFee))}
        aria-label={`Biaya pendaftaran ${SCHOOL_SHORT[schoolKey]}`}
        onChange={(feeOverride) => onChange({ feeOverride })}
      />
      <span className="text-xs text-muted-foreground">
        {draft.feeOverride === "" ? `Mengikuti biaya dasar · ${rupiah(String(defaultFee))}` : null}
      </span>
    </div>
  );
}

function RequirementField({
  id,
  schoolKey,
  document,
  draft,
  onChange,
  disabled,
}: CellProps & { id?: string | undefined; document: { type: DocumentType; label: string } }) {
  return (
    <Select
      value={draft.documents[document.type]}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "string" && isRequirement(next)) {
          onChange({ documents: { ...draft.documents, [document.type]: next } });
        }
      }}
    >
      <SelectTrigger
        id={id}
        className="w-full"
        aria-label={`${document.label} untuk ${SCHOOL_SHORT[schoolKey]}`}
      >
        <SelectValue>
          {(value: string) => REQUIREMENTS.find((option) => option.value === value)?.label ?? value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {REQUIREMENTS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Prose does not fit a matrix cell, so the two long fields open beside it. */
function InstructionsDialog({ schoolKey, draft, onChange, disabled }: CellProps) {
  const written = [draft.acceptedInstructions, draft.rejectedInstructions].filter(
    (text) => text.trim() !== "",
  ).length;

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {written === 2 ? "Ubah teks" : `Lengkapi (${written}/2)`}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Teks keputusan · {SCHOOL_SHORT[schoolKey]}</DialogTitle>
          <DialogDescription>
            Dikirim ke orang tua setelah hasil diumumkan. Catatan internal tidak ikut terkirim.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <Field label="Teks diterima">
            {(id) => (
              <Textarea
                id={id}
                value={draft.acceptedInstructions}
                disabled={disabled}
                placeholder="Langkah berikutnya untuk calon yang diterima."
                onChange={(event) => onChange({ acceptedInstructions: event.target.value })}
              />
            )}
          </Field>
          <Field label="Teks tidak diterima">
            {(id) => (
              <Textarea
                id={id}
                value={draft.rejectedInstructions}
                disabled={disabled}
                placeholder="Apa yang disampaikan bila tidak diterima."
                onChange={(event) => onChange({ rejectedInstructions: event.target.value })}
              />
            )}
          </Field>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Tutup</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rupiah runs to six and seven digits, so the field shows grouped thousands
 * while the value stays digits only. `250.000` is readable at a glance;
 * `250000` has to be counted.
 *
 * The caret is restored by hand after each keystroke. Reformatting moves every
 * separator, so without this the caret jumps to the end the moment anyone
 * corrects a digit in the middle.
 */
function CurrencyInput({
  id,
  value,
  onChange,
  disabled,
  placeholder,
  className,
  ...props
}: {
  id?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
} & Pick<React.ComponentProps<"input">, "aria-label">) {
  const field = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (caret.current === null) return;
    field.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <InputGroupText>Rp</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        ref={field}
        id={id}
        inputMode="numeric"
        className="tabular-nums"
        disabled={disabled}
        placeholder={placeholder}
        value={formatRupiah(value)}
        onChange={(event) => {
          const next = reformatRupiah(event.target.value, event.target.selectionStart ?? 0);
          caret.current = next.caret;
          onChange(next.digits);
        }}
        {...props}
      />
    </InputGroup>
  );
}

/**
 * shadcn ships no time picker: its date picker is Calendar in a Popover, and
 * the time is a native input. Both halves edit one instant.
 *
 * The instant is stored UTC and edited in the browser's own zone, which is
 * Asia/Jakarta for the committee. The read-back label states the zone so a
 * machine set to something else is visible rather than silently wrong.
 */
function DateTimeField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const date = new Date(value);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  const setDay = (day: Date) => {
    const next = new Date(date);
    next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    onChange(next.toISOString());
  };

  const setTime = (input: string) => {
    const [hours, minutes] = input.split(":").map(Number);
    if (
      hours === undefined ||
      minutes === undefined ||
      Number.isNaN(hours) ||
      Number.isNaN(minutes)
    )
      return;
    const next = new Date(date);
    next.setHours(hours, minutes, 0, 0);
    onChange(next.toISOString());
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                id={id}
                type="button"
                variant="outline"
                disabled={disabled}
                className="flex-1 justify-start font-normal"
              >
                <CalendarIcon />
                {date.toLocaleDateString("id-ID", { dateStyle: "long" })}
              </Button>
            }
          />
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(day) => {
                if (day) setDay(day);
              }}
            />
          </PopoverContent>
        </Popover>
        <Input
          type="time"
          aria-label="Jam"
          className="w-28 tabular-nums"
          value={time}
          disabled={disabled}
          onChange={(event) => setTime(event.target.value)}
        />
      </div>
      <span className="text-xs text-muted-foreground">
        {date.toLocaleString("id-ID", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Jakarta",
        })}{" "}
        WIB
      </span>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/** For a control that labels itself, where a `for` would point at nothing. */
function LabelledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 opacity-100 transition-opacity duration-150 ease-out starting:opacity-0"
    >
      <p className="text-sm text-destructive">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Coba lagi
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- helpers

function schoolName(key: SchoolKey) {
  return SCHOOLS.find((school) => school.key === key)?.name ?? key;
}

function isRequirement(value: string): value is Requirement {
  return REQUIREMENTS.some((option) => option.value === value);
}

function rupiah(digits: string) {
  return `Rp ${formatRupiah(digits) || "0"}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Renders one layout rather than shipping both and hiding one with CSS. */
function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
