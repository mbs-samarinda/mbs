import { APPLICANT_RULES, type ApplicantField } from "@mbs/api-contract/applicant-rules";
import type { GUARDIAN_RELATIONS, SEXES } from "@mbs/school-config";
import { Alert } from "@mbs/ui/components/alert";
import { Button } from "@mbs/ui/components/button";
import { Input } from "@mbs/ui/components/input";
import { Label } from "@mbs/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@mbs/ui/components/native-select";
import {
  useIsMutating,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Navigate,
  notFound,
  redirect,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { cn } from "cn";
import { CheckIcon, CircleAlertIcon } from "lucide-react";
import { useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { applicationsQuery } from "../api.ts";
import { cyclesQuery, type SchoolCycle } from "../cycles.ts";
import {
  draftSent,
  draftOf,
  editDraft,
  EMPTY_VALUES,
  lastSent,
  renewKey,
  sameValues,
  useDraft,
  type Draft,
  type ValueName,
  type Values,
} from "../draft.ts";
import { formatDate, formatFee, MONTHS, schoolName } from "../format.ts";
import {
  errorsIn,
  firstOpenStep,
  isStep,
  offeredSchools,
  openForm,
  STEP_FIELDS,
  STEPS,
  toProfile,
  type Step,
} from "../registration.ts";
import { SchoolLogo } from "../school-logo.tsx";
import { explainSubmit, sendDraft } from "../submit.ts";
import { useSingleFlight } from "../use-single-flight.ts";

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** The step this page was opened from, so "Kembali" can be the browser's own back. */
    from?: Step;
    /** How many of the form's pages sit under this one in the history. */
    depth?: number;
  }
}

const TITLES: Record<Step, string> = {
  sekolah: "Pilih sekolah",
  anak: "Data anak",
  wali: "Orang tua/wali",
  periksa: "Periksa sebelum dikirim",
};

const SEND = ["send-registration"];

/** `dari` marks an edit that goes straight back to the check. */
type FormSearch = { dari?: "periksa" | undefined };

export const Route = createFileRoute("/_app/daftar/$langkah")({
  validateSearch: ({ dari }: Record<string, unknown>): FormSearch => ({
    dari: dari === "periksa" ? dari : undefined,
  }),
  params: {
    parse: ({ langkah }) => {
      if (!isStep(langkah)) throw notFound();
      return { langkah };
    },
  },
  beforeLoad: async ({ context, params, location }) => {
    const { draft, firstOpen } = await openForm(context);
    if (STEPS.indexOf(params.langkah) <= STEPS.indexOf(firstOpen)) return;
    const applicationId = lastSent();
    if (!draft && applicationId) {
      throw redirect({ to: "/status/$applicationId", params: { applicationId }, replace: true });
    }
    throw redirect({
      to: "/daftar/$langkah",
      params: { langkah: firstOpen },
      state: () => location.state,
      replace: true,
    });
  },
  head: ({ params }) => ({
    meta: [{ title: `${TITLES[params.langkah]} · Pendaftaran Madina Boarding School` }],
  }),
  component: Form,
});

function Form() {
  const { account } = Route.useRouteContext();
  const { langkah } = Route.useParams();
  const { draft, saved } = useDraft(account.id);
  const { data: schools } = useSuspenseQuery(cyclesQuery);

  // Sent or cleared in another tab. Home shows what became of it, unless this tab
  // is still waiting for an answer of its own and goes on to that.
  const sending = useIsMutating({ mutationKey: SEND }) > 0;
  if (!draft && langkah !== "sekolah" && !sending) return <Navigate to="/" replace />;
  // Another tab can empty a field without a navigation here to notice it.
  const firstOpen = firstOpenStep(draft, schools);
  if (langkah === "periksa" && draft && !sending && firstOpen !== langkah) {
    return <Navigate to="/daftar/$langkah" params={{ langkah: firstOpen }} replace />;
  }

  const values = draft?.values ?? EMPTY_VALUES;
  const school = schools.find(({ schoolKey }) => schoolKey === values.schoolKey);
  const number = STEPS.indexOf(langkah) + 1;
  const set = (changes: Partial<Values>) => editDraft(account.id, changes);
  return (
    <div className="grid grid-cols-1 gap-8" key={langkah}>
      <div className="grid gap-4">
        <div className="flex flex-wrap justify-between gap-x-4 text-sm text-muted-foreground">
          <span>
            Langkah {number} dari {STEPS.length}
          </span>
          {school && langkah !== "sekolah" && <span>{schoolName(school.schoolKey)}</span>}
        </div>
        <div aria-hidden className="grid grid-cols-4 gap-1.5">
          {STEPS.map((step, index) => (
            <span
              key={step}
              className={cn("h-1 rounded-full", index < number ? "bg-primary" : "bg-border")}
            />
          ))}
        </div>
        <h1 tabIndex={-1} className="text-2xl font-semibold text-balance outline-none">
          {TITLES[langkah]}
        </h1>
      </div>
      {sending && langkah !== "periksa" ? (
        // What is typed now would not be in the form that is on its way.
        <output className="text-muted-foreground">
          Pendaftaran sedang dikirim. Tunggu sebentar, isiannya belum bisa diubah.
        </output>
      ) : langkah === "sekolah" ? (
        <SchoolStep
          values={values}
          set={set}
          offered={offeredSchools(schools, draft?.attempt ?? null)}
        />
      ) : langkah === "anak" ? (
        <ChildStep values={values} set={set} />
      ) : langkah === "wali" ? (
        <GuardianStep values={values} set={set} />
      ) : null}
      {langkah === "periksa" && draft && <CheckStep draft={draft} schools={schools} />}
      {saved && draft && (
        <p className="flex items-center gap-1.5 justify-self-center text-sm text-muted-foreground">
          <CheckIcon aria-hidden className="size-4 shrink-0" />
          Isian tersimpan di perangkat ini
        </p>
      )}
    </div>
  );
}

/** Moves between steps so that the browser's back and "Kembali" always agree. */
function useSteps() {
  const router = useRouter();
  const navigate = Route.useNavigate();
  const { langkah } = Route.useParams();
  const { dari } = Route.useSearch();
  const { from, depth = 0 } = useLocation().state;
  const number = STEPS.indexOf(langkah);

  const backTo = (step: Step) =>
    from === step
      ? router.history.back()
      : void navigate({
          params: { langkah: step },
          search: {},
          state: { depth },
          replace: true,
        });
  return {
    editing: dari !== undefined,
    back: number === 0 && !dari ? null : () => backTo(dari ?? STEPS[number - 1]!),
    next: () => {
      if (dari) return backTo(dari);
      void navigate({
        params: { langkah: STEPS[number + 1]! },
        search: {},
        state: { from: langkah, depth: depth + 1 },
      });
    },
  };
}

type StepProps = { values: Values; set: (changes: Partial<Values>) => void };

/**
 * One step's form. Errors wait for the first "Lanjut", then follow what is typed.
 * The count is announced, and focus goes to the first field, which reads its own.
 */
function StepForm<F extends string>({
  fields,
  errorsOf,
  children,
}: {
  fields: readonly F[];
  errorsOf: () => { [K in F]?: string };
  children: (errors: { [K in F]?: string }) => ReactNode;
}) {
  const { editing, back, next } = useSteps();
  const [checked, setChecked] = useState(false);
  const [announced, setAnnounced] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = errorsOf();
    const wrong = fields.filter((field) => errors[field] !== undefined);
    const first = wrong[0];
    if (first === undefined) return next();
    flushSync(() => {
      setChecked(true);
      setAnnounced(`Ada ${wrong.length} isian yang perlu diperbaiki.`);
    });
    focusField(first);
  };

  return (
    <form noValidate onSubmit={submit} className="grid grid-cols-1 gap-8">
      <p role="alert" className="sr-only">
        {announced}
      </p>
      <div className="grid grid-cols-1 gap-5">{children(checked ? errorsOf() : {})}</div>
      <div className="grid gap-2">
        <Button type="submit" size="touch">
          {editing ? "Simpan" : "Lanjut"}
        </Button>
        {back && (
          <Button type="button" variant="ghost" size="touch" onClick={back}>
            Kembali
          </Button>
        )}
      </div>
    </form>
  );
}

/** A field's own control, or in a group the one to start from. */
function focusField(field: string) {
  const element = document.getElementById(field);
  const control = element?.matches("fieldset")
    ? (element.querySelector<HTMLElement>("input:checked") ??
      [...element.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")].find(
        (part) => part.type === "radio" || part.value.trim() === "",
      ) ??
      element.querySelector<HTMLElement>("input"))
    : element;
  control?.focus();
}

function SchoolStep({ values, set, offered }: StepProps & { offered: readonly SchoolCycle[] }) {
  const chosen = offered.find(({ schoolKey }) => schoolKey === values.schoolKey);
  return (
    <StepForm
      fields={["schoolKey"]}
      errorsOf={() => (chosen ? {} : { schoolKey: "Pilih sekolah untuk anak kamu." })}
    >
      {(errors) => (
        <fieldset
          id="schoolKey"
          aria-label={TITLES.sekolah}
          aria-describedby={describedBy("schoolKey", { error: errors.schoolKey })}
          className="grid grid-cols-1 gap-2"
        >
          {offered.map(({ schoolKey, cycle }) => (
            <label
              key={schoolKey}
              className="flex min-h-16 cursor-pointer items-center gap-3.5 rounded-xl border border-input px-3.5 py-2.5 has-checked:border-primary has-checked:bg-info-tint"
            >
              <input
                type="radio"
                name="schoolKey"
                value={schoolKey}
                checked={schoolKey === values.schoolKey}
                onChange={() => set({ schoolKey })}
                className="size-4 shrink-0 accent-primary"
              />
              <SchoolLogo school={schoolKey} className="size-9" />
              <span className="min-w-0 flex-1 wrap-anywhere">
                <span className="block text-sm font-semibold">{schoolName(schoolKey)}</span>
                {cycle && (
                  <span className="block text-sm text-muted-foreground">
                    {formatFee(cycle.effectiveFee)}
                  </span>
                )}
              </span>
            </label>
          ))}
          <FieldError field="schoolKey">{errors.schoolKey}</FieldError>
        </fieldset>
      )}
    </StepForm>
  );
}

const SEX_LABELS: Record<(typeof SEXES)[number], string> = {
  MALE: "Laki-laki",
  FEMALE: "Perempuan",
};
const RELATION_LABELS: Record<(typeof GUARDIAN_RELATIONS)[number], string> = {
  FATHER: "Ayah",
  MOTHER: "Ibu",
  GUARDIAN: "Wali",
};

// The child's fields refuse autofill, which would put the guardian's own name
// and birthday in them.
function ChildStep({ values, set }: StepProps) {
  return (
    <StepForm fields={STEP_FIELDS.anak} errorsOf={() => errorsIn(values, STEP_FIELDS.anak)}>
      {(errors) => (
        <>
          <TextField
            field="childFullName"
            label="Nama lengkap anak"
            hint="Sama dengan di akta kelahiran."
            error={errors.childFullName}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            value={values.childFullName}
            onChange={(event) => set({ childFullName: event.target.value })}
          />
          <TextField
            field="nik"
            label="NIK anak"
            hint="16 angka, ada di kartu keluarga."
            error={errors.nik}
            autoComplete="off"
            inputMode="numeric"
            value={values.nik}
            onChange={(event) => set({ nik: event.target.value })}
          />
          <BirthDate values={values} set={set} error={errors.birthDate} />
          <Choices
            field="sex"
            label="Jenis kelamin"
            options={SEX_LABELS}
            error={errors.sex}
            value={values.sex}
            onChange={(sex) => set({ sex })}
            className="grid-cols-[repeat(auto-fit,minmax(min(8.5rem,100%),1fr))]"
          />
          <TextField
            field="schoolOfOrigin"
            label="Asal sekolah"
            error={errors.schoolOfOrigin}
            autoComplete="off"
            placeholder="cth. SDN 004 Samarinda Ulu"
            value={values.schoolOfOrigin}
            onChange={(event) => set({ schoolOfOrigin: event.target.value })}
          />
        </>
      )}
    </StepForm>
  );
}

function GuardianStep({ values, set }: StepProps) {
  return (
    <StepForm fields={STEP_FIELDS.wali} errorsOf={() => errorsIn(values, STEP_FIELDS.wali)}>
      {(errors) => (
        <>
          <TextField
            field="guardianName"
            label="Nama lengkap orang tua/wali"
            error={errors.guardianName}
            autoComplete="name"
            autoCapitalize="words"
            spellCheck={false}
            value={values.guardianName}
            onChange={(event) => set({ guardianName: event.target.value })}
          />
          <Choices
            field="guardianRelation"
            label="Hubungan dengan anak"
            options={RELATION_LABELS}
            error={errors.guardianRelation}
            value={values.guardianRelation}
            onChange={(guardianRelation) => set({ guardianRelation })}
            className="grid-cols-[repeat(auto-fit,minmax(min(5.5rem,100%),1fr))]"
          />
          <TextField
            field="guardianPhone"
            label="Nomor HP"
            hint="Panitia menghubungi nomor ini kalau perlu."
            error={errors.guardianPhone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="cth. 0812 3456 7890"
            value={values.guardianPhone}
            onChange={(event) => set({ guardianPhone: event.target.value })}
          />
        </>
      )}
    </StepForm>
  );
}

const CONTROL = "h-11 rounded-xl px-3.5";
/** Above what the rules allow, so a long paste is answered and not cut in silence. */
const MAX_LENGTH = 400;

function TextField({
  field,
  label,
  hint,
  error,
  ...input
}: {
  field: ApplicantField;
  label: string;
  hint?: string;
  error: string | undefined;
} & ComponentProps<typeof Input>) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <Label htmlFor={field}>{label}</Label>
      <Input
        id={field}
        name={field}
        maxLength={MAX_LENGTH}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(field, { error, hint })}
        className={CONTROL}
        {...input}
      />
      {hint && (
        <p id={`${field}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      <FieldError field={field}>{error}</FieldError>
    </div>
  );
}

function BirthDate({ values, set, error }: StepProps & { error: string | undefined }) {
  const part = {
    required: true,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy("birthDate", { error }),
    autoComplete: "off",
  } as const;
  const number = { ...part, inputMode: "numeric" } as const;
  const on = (name: ValueName) => ({
    value: values[name],
    onChange: (event: { target: { value: string } }) => set({ [name]: event.target.value }),
  });
  return (
    <Group field="birthDate" label="Tanggal lahir" error={error}>
      <div className="flex flex-wrap gap-2">
        <Input
          {...number}
          {...on("birthDay")}
          aria-label="Tanggal"
          placeholder="14"
          maxLength={2}
          className={cn(CONTROL, "w-16 flex-none")}
        />
        <NativeSelect
          {...part}
          {...on("birthMonth")}
          size="touch"
          aria-label="Bulan"
          className="min-w-0 flex-[1_0_8rem]"
        >
          <NativeSelectOption value="">Bulan</NativeSelectOption>
          {MONTHS.map(({ value, name }) => (
            <NativeSelectOption key={value} value={value}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Input
          {...number}
          {...on("birthYear")}
          aria-label="Tahun"
          placeholder="2014"
          maxLength={4}
          className={cn(CONTROL, "w-20 flex-none")}
        />
      </div>
    </Group>
  );
}

function Choices<V extends string>({
  field,
  label,
  options,
  error,
  value,
  onChange,
  className,
}: {
  field: ApplicantField;
  label: string;
  options: Record<V, string>;
  error: string | undefined;
  value: string;
  onChange: (value: string) => void;
  className: string;
}) {
  return (
    <Group field={field} label={label} error={error}>
      <div className={cn("grid gap-2", className)}>
        {Object.entries<string>(options).map(([option, name]) => (
          <label
            key={option}
            className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-input px-3.5 text-sm font-medium has-checked:border-primary has-checked:bg-info-tint"
          >
            <input
              type="radio"
              name={field}
              value={option}
              required
              checked={option === value}
              onChange={() => onChange(option)}
              className="size-4 shrink-0 accent-primary"
            />
            {name}
          </label>
        ))}
      </div>
    </Group>
  );
}

function Group({
  field,
  label,
  error,
  children,
}: {
  field: ApplicantField;
  label: string;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <fieldset
      id={field}
      aria-describedby={describedBy(field, { error })}
      className="grid grid-cols-1 gap-2"
    >
      <legend className="mb-2 text-sm leading-none font-medium">{label}</legend>
      {children}
      <FieldError field={field}>{error}</FieldError>
    </fieldset>
  );
}

function describedBy(
  field: string,
  { error, hint }: { error: string | undefined; hint?: string | undefined },
) {
  const ids = [error && `${field}-error`, hint && `${field}-hint`].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function FieldError({ field, children }: { field: string; children: string | undefined }) {
  if (!children) return null;
  return (
    <p id={`${field}-error`} className="flex items-start gap-1.5 text-sm text-destructive">
      <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 text-pretty">{children}</span>
    </p>
  );
}

function CheckStep({ draft, schools }: { draft: Draft; schools: readonly SchoolCycle[] }) {
  const { account } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { back } = useSteps();
  const { values } = draft;
  const profile = toProfile(values);
  const school = schools.find(({ schoolKey }) => schoolKey === values.schoolKey);

  const send = useMutation({
    mutationKey: SEND,
    mutationFn: async () => {
      const { applicationId, result } = await sendDraft(draft, schools);
      // Another tab may have typed on while this one was sending.
      const now = draftOf(account.id);
      const edited = now !== null && !sameValues(now.values, values);
      const edits =
        result === "earlierOther"
          ? "tersimpan"
          : result === "earlier" || edited
            ? "tertinggal"
            : undefined;
      // Dropped, not refreshed: home would show the list without this child first.
      const list = applicationsQuery(account.id);
      queryClient.removeQueries({ queryKey: list.queryKey, exact: true });
      void queryClient.prefetchQuery(list);
      const { pathname, state } = router.state.location;
      const onForm = pathname.startsWith("/daftar/");
      // Back to the form's first page before replacing it, so that none of its
      // pages are left under the status.
      if (onForm && state.depth) await stepBack(router.history, state.depth);
      // Elsewhere, only edits that did not go out are worth an interruption.
      if (onForm || (edits && pathname === "/")) {
        await router.navigate({
          to: "/status/$applicationId",
          params: { applicationId },
          search: { ubahan: edits },
          replace: onForm,
        });
      }
      // Last, so a crash before this leaves a form that can be sent again.
      if (result === "earlierOther") renewKey(account.id);
      else draftSent(applicationId);
    },
  });
  const sendOnce = useSingleFlight(send);
  // Counted by the key, so leaving this step and coming back still finds it.
  const sending = useIsMutating({ mutationKey: SEND }) > 0;
  const failure = send.error && !sending ? explainSubmit(send.error, draft) : null;

  return (
    <form
      noValidate
      className="grid grid-cols-1 gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        if (queryClient.isMutating({ mutationKey: SEND }) === 0) sendOnce();
      }}
    >
      <div className="grid grid-cols-1 gap-5">
        <Review title="Sekolah" step="sekolah" locked={sending}>
          <Row label="Sekolah">{school && schoolName(school.schoolKey)}</Row>
          {school?.cycle && (
            <Row label="Biaya pendaftaran">{formatFee(school.cycle.effectiveFee)}</Row>
          )}
        </Review>
        <Review title="Anak" step="anak" locked={sending}>
          <Row label="Nama lengkap">{profile.childFullName}</Row>
          <Row label="NIK">{inGroups(profile.nik)}</Row>
          <Row label="Tanggal lahir">{formatDate(profile.birthDate)}</Row>
          <Row label="Jenis kelamin">{labelOf(SEX_LABELS, profile.sex)}</Row>
          <Row label="Asal sekolah">{profile.schoolOfOrigin}</Row>
        </Review>
        <Review title="Orang tua/wali" step="wali" locked={sending}>
          <Row label="Nama lengkap">{profile.guardianName}</Row>
          <Row label="Hubungan">{labelOf(RELATION_LABELS, profile.guardianRelation)}</Row>
          <Row label="Nomor HP">{profile.guardianPhone}</Row>
          <Row label="Email untuk kabar pendaftaran">{account.email}</Row>
        </Review>
      </div>
      <div className="grid gap-2">
        {failure && (
          <Alert className="mb-2">
            {failure.message}
            {failure.wayOut && (
              <Link to="/" className="inline-flex min-h-11 items-center font-medium underline">
                Buka halaman utama
              </Link>
            )}
          </Alert>
        )}
        <Button type="submit" size="touch" disabled={sending} focusableWhenDisabled>
          {sending ? "Mengirim…" : "Kirim pendaftaran"}
        </Button>
        {back && (
          <Button type="button" variant="ghost" size="touch" disabled={sending} onClick={back}>
            Kembali
          </Button>
        )}
      </div>
    </form>
  );
}

function Review({
  title,
  step,
  locked,
  children,
}: {
  title: string;
  step: Step;
  locked: boolean;
  children: ReactNode;
}) {
  const { depth = 0 } = useLocation().state;
  return (
    <section className="grid grid-cols-1 gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold">{title}</h2>
        <Link
          to="/daftar/$langkah"
          disabled={locked}
          params={{ langkah: step }}
          search={{ dari: "periksa" }}
          state={{ from: "periksa", depth: depth + 1 }}
          className="inline-flex min-h-11 min-w-11 items-center justify-end text-sm font-medium text-primary"
        >
          Ubah <span className="sr-only">{title.toLowerCase()}</span>
        </Link>
      </div>
      <dl className="grid grid-cols-1 gap-3">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium wrap-anywhere">{children}</dd>
    </div>
  );
}

function labelOf(labels: Record<string, string>, value: string) {
  return labels[value];
}

function inGroups(nik: string) {
  const result = APPLICANT_RULES.nik(nik);
  return result.ok ? result.value.replaceAll(/(\d{4})(?=\d)/g, "$1 ") : nik;
}

/** Resolves once the browser has gone back, or after a moment if it cannot. */
function stepBack(history: ReturnType<typeof useRouter>["history"], steps: number) {
  return new Promise<void>((resolve) => {
    const stop = history.subscribe(() => {
      stop();
      resolve();
    });
    setTimeout(() => {
      stop();
      resolve();
    }, 1000);
    history.go(-steps);
  });
}
