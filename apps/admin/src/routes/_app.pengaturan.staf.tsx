import { ORPCError } from "@mbs/api-client/rpc";
import {
  CreateStaffInput,
  UpdateStaffInput,
  type StaffRole,
  type StaffSummary,
} from "@mbs/api-contract";
import { SCHOOL_KEYS, STAFF_ROLES, type SchoolKey } from "@mbs/school-config";
import { Alert } from "@mbs/ui/components/alert";
import { Button } from "@mbs/ui/components/button";
import { Checkbox } from "@mbs/ui/components/checkbox";
import { Input } from "@mbs/ui/components/input";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@mbs/ui/components/sheet";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "cn";
import { PlusIcon, XIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { chipClass, EXACT_MATCH, Field, SchoolMark, Tile } from "../committee-ui.tsx";
import { formatAgo, formatCount } from "../format.ts";
import { api, issuesByField, staffListQuery } from "../staff.ts";

type Show = "aktif" | "nonaktif";

export const Route = createFileRoute("/_app/pengaturan/staf")({
  validateSearch: (search: Record<string, unknown>): { tampil?: Show | undefined } => ({
    tampil: search.tampil === "aktif" || search.tampil === "nonaktif" ? search.tampil : undefined,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(staffListQuery),
  head: () => ({ meta: [{ title: "Staf · Panitia PPDB" }] }),
  component: StaffPage,
});

const ROLES: Record<StaffRole, { label: string; meaning: string }> = {
  ADMINISTRATOR: {
    label: "Administrator",
    meaning: "Mengatur periode dan staf, dan memeriksa pendaftar.",
  },
  STAFF: { label: "Staf", meaning: "Memeriksa pendaftar." },
  PRINCIPAL: { label: "Kepala sekolah", meaning: "Hanya melihat." },
};

const SCHOOL_DOMAIN = "@mbss.sch.id";

type Editing = { kind: "new" } | { kind: "edit"; id: string } | null;

function StaffPage() {
  const { tampil } = Route.useSearch();
  const { data: staff } = useSuspenseQuery(staffListQuery);
  const [editing, setEditing] = useState<Editing>(null);

  const active = staff.filter((row) => row.isActive).length;
  const shown = staff.filter((row) =>
    tampil === undefined ? true : row.isActive === (tampil === "aktif"),
  );
  const open = editing?.kind === "edit" ? staff.find((row) => row.id === editing.id) : undefined;

  return (
    <div className="grid content-start gap-6 p-[min(2rem,5vw)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 tabIndex={-1} className="text-2xl font-semibold outline-none">
            Staf
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatCount(active)} aktif, {formatCount(staff.length - active)} nonaktif
          </p>
        </div>
        <Button onClick={() => setEditing({ kind: "new" })}>
          <PlusIcon aria-hidden /> Tambah staf
        </Button>
      </div>
      <nav aria-label="Saring staf" className="flex flex-wrap gap-1">
        {(
          [
            [undefined, "Semua"],
            ["aktif", "Aktif"],
            ["nonaktif", "Nonaktif"],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={label}
            to="/pengaturan/staf"
            search={{ tampil: value }}
            activeOptions={EXACT_MATCH}
            className={chipClass(tampil === value)}
          >
            {label}
          </Link>
        ))}
      </nav>

      {shown.length > 0 ? (
        <ul className="grid divide-y divide-border border-y border-border">
          {shown.map((row) => (
            <li key={row.id}>
              <Row row={row} onOpen={() => setEditing({ kind: "edit", id: row.id })} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {tampil === "nonaktif" ? "Tidak ada staf nonaktif." : "Belum ada staf."}
        </p>
      )}

      <Sheet open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          {editing && (
            <StaffForm
              key={editing.kind === "edit" ? editing.id : "new"}
              staff={open ?? null}
              onDone={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ row, onOpen }: { row: StaffSummary; onOpen: () => void }) {
  const [first, ...more] = row.loginEmails;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "grid w-full grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-6 py-3 text-left hover:bg-muted/50 max-md:grid-cols-1 max-md:gap-1",
        !row.isActive && "text-muted-foreground",
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <Tile name={row.name} />
        <span className="grid min-w-0">
          <span className="truncate font-medium" title={row.name}>
            {row.name}
          </span>
          <span className="flex min-w-0 gap-1 text-sm text-muted-foreground">
            <span className="truncate" title={first?.email}>
              {first?.email}
            </span>
            {more.length > 0 && <span className="shrink-0">+{more.length}</span>}
          </span>
        </span>
      </span>
      <span
        className={cn(
          "text-sm max-md:pl-12",
          row.role === "ADMINISTRATOR" && row.isActive && "font-medium",
        )}
      >
        {ROLES[row.role].label}
      </span>
      <span className="max-md:pl-12">
        <Schools keys={row.schools} />
      </span>
      <span className="text-sm text-muted-foreground max-md:pl-12">
        {!row.isActive
          ? "Nonaktif"
          : row.lastSignInAt
            ? `Masuk ${formatAgo(row.lastSignInAt)}`
            : "Belum pernah masuk"}
      </span>
    </button>
  );
}

function Schools({ keys }: { keys: readonly SchoolKey[] }) {
  if (SCHOOL_KEYS.every((key) => keys.includes(key))) {
    return <span className="text-sm">Semua sekolah</span>;
  }
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {SCHOOL_KEYS.filter((key) => keys.includes(key)).map((key) => (
        <SchoolMark key={key} school={key} />
      ))}
    </span>
  );
}

function StaffForm({ staff, onDone }: { staff: StaffSummary | null; onDone: () => void }) {
  const { visitor } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const mine = SCHOOL_KEYS.filter(
    (key) => visitor.kind === "staff" && visitor.staff.schools.includes(key),
  );

  const [name, setName] = useState(staff?.name ?? "");
  const [emails, setEmails] = useState(
    (staff?.loginEmails.map((row) => row.email) ?? [""]).map((email) => ({
      id: crypto.randomUUID(),
      email,
    })),
  );
  const filled = emails.filter((row) => row.email.trim());
  const [role, setRole] = useState<StaffRole>(staff?.role ?? "STAFF");
  const [schools, setSchools] = useState<SchoolKey[]>(staff ? [...staff.schools] : []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const id = useId();

  const refresh = (saved: StaffSummary) => {
    queryClient.setQueryData(staffListQuery.queryKey, (list) =>
      list && list.some((row) => row.id === saved.id)
        ? list.map((row) => (row.id === saved.id ? saved : row))
        : [...(list ?? []), saved],
    );
    void queryClient.invalidateQueries({ queryKey: staffListQuery.queryKey });
  };

  const save = useMutation({
    mutationFn: (input: CreateStaffInput) =>
      staff
        ? api.admin.staff.update({ ...input, staffId: staff.id })
        : api.admin.staff.create(input),
    onSuccess: (saved) => {
      refresh(saved);
      onDone();
    },
    onError: (error) => {
      if (error instanceof ORPCError && error.code === "EMAIL_TAKEN") {
        const taken = filled.find((row) => row.email.trim().toLowerCase() === error.data?.email);
        setErrors({ [`email:${taken?.id ?? ""}`]: "Email ini sudah dipakai staf lain." });
      }
    },
  });

  const toggle = useMutation({
    mutationFn: (isActive: boolean) => api.admin.staff.setActive({ staffId: staff!.id, isActive }),
    onSuccess: (saved) => {
      refresh(saved);
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const input = { name, emails: filled.map((row) => row.email), role, schools };
    const parsed = (staff ? UpdateStaffInput : CreateStaffInput).safeParse({
      ...input,
      staffId: staff?.id,
    });
    const found = parsed.success ? {} : issuesByField(parsed.error.issues);
    if (!input.name.trim()) found.name = "Isi nama staf.";
    if (input.emails.length === 0)
      found[`email:${emails[0]?.id ?? ""}`] = "Isi minimal satu email.";
    else if (!input.emails.some((email) => email.trim().toLowerCase().endsWith(SCHOOL_DOMAIN))) {
      found.emails = `Satu email harus berakhiran ${SCHOOL_DOMAIN}.`;
    }
    if (input.schools.length === 0) found.schools = "Pilih minimal satu sekolah.";
    // The contract numbers the filled addresses; the form keys each row by its own id.
    for (const key of Object.keys(found)) {
      const index = /^emails\.(\d+)$/.exec(key)?.[1];
      if (index === undefined) continue;
      delete found[key];
      found[`email:${filled[Number(index)]?.id ?? ""}`] = "Email ini belum benar.";
    }
    setErrors(found);
    if (Object.keys(found).length === 0 && parsed.success) save.mutate(parsed.data);
  }

  const failed =
    (save.error && !(save.error instanceof ORPCError && save.error.code === "EMAIL_TAKEN")) ||
    toggle.error;
  const lastAdministrator = failed instanceof ORPCError && failed.code === "LAST_ADMINISTRATOR";

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader>
        <SheetTitle className="truncate pr-8">{staff ? staff.name : "Tambah staf"}</SheetTitle>
      </SheetHeader>
      <div className="grid flex-1 content-start gap-5 overflow-y-auto px-4 pb-4">
        <Field label="Nama" error={errors.name}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            aria-invalid={errors.name ? true : undefined}
          />
        </Field>

        <fieldset className="grid gap-1.5 text-sm">
          <legend className="pb-1.5 font-medium">Email untuk masuk</legend>
          {emails.map(({ id: rowId, email }, index) => (
            <div key={rowId} className="grid gap-1">
              <div className="flex gap-1">
                <Input
                  type="email"
                  value={email}
                  aria-label={`Email ${index + 1}`}
                  aria-invalid={errors[`email:${rowId}`] ? true : undefined}
                  onChange={(event) =>
                    setEmails(
                      emails.map((row) =>
                        row.id === rowId ? { ...row, email: event.target.value } : row,
                      ),
                    )
                  }
                />
                {emails.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Hapus email ${index + 1}`}
                    onClick={() => setEmails(emails.filter((row) => row.id !== rowId))}
                  >
                    <XIcon aria-hidden />
                  </Button>
                )}
              </div>
              {errors[`email:${rowId}`] && (
                <span className="text-xs text-destructive">{errors[`email:${rowId}`]}</span>
              )}
            </div>
          ))}
          {emails.length < 5 && (
            <button
              type="button"
              onClick={() => setEmails([...emails, { id: crypto.randomUUID(), email: "" }])}
              className="w-fit text-muted-foreground hover:text-foreground hover:underline"
            >
              Tambah email
            </button>
          )}
          <span
            className={cn(
              "text-xs text-pretty",
              errors.emails ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {errors.emails ??
              `Masuk dengan Google memakai salah satu email ini. Satu harus ${SCHOOL_DOMAIN}.`}
          </span>
        </fieldset>

        <fieldset className="grid gap-2 text-sm">
          <legend className="pb-1.5 font-medium">Peran</legend>
          {STAFF_ROLES.map((value) => (
            <div key={value} className="flex items-start gap-2">
              <input
                id={`${id}-${value}`}
                type="radio"
                name="role"
                checked={role === value}
                onChange={() => setRole(value)}
                aria-describedby={`${id}-${value}-meaning`}
                className="mt-1 accent-primary"
              />
              <span className="grid">
                <label htmlFor={`${id}-${value}`}>{ROLES[value].label}</label>
                <span id={`${id}-${value}-meaning`} className="text-xs text-muted-foreground">
                  {ROLES[value].meaning}
                </span>
              </span>
            </div>
          ))}
        </fieldset>

        <fieldset className="grid gap-2 text-sm">
          <legend className="pb-1.5 font-medium">Sekolah</legend>
          {mine.map((key) => (
            <label key={key} htmlFor={`${id}-${key}`} className="flex items-center gap-2">
              <Checkbox
                id={`${id}-${key}`}
                checked={schools.includes(key)}
                onCheckedChange={(checked) =>
                  setSchools(
                    checked
                      ? SCHOOL_KEYS.filter((each) => each === key || schools.includes(each))
                      : schools.filter((each) => each !== key),
                  )
                }
              />
              <SchoolMark school={key} />
            </label>
          ))}
          {errors.schools && <span className="text-xs text-destructive">{errors.schools}</span>}
        </fieldset>

        {staff && (
          <div className="grid gap-1 border-t border-border pt-4 text-sm">
            {staff.isActive ? (
              <>
                <button
                  type="button"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(false)}
                  className="w-fit text-destructive hover:underline disabled:opacity-50"
                >
                  Nonaktifkan
                </button>
                <span className="text-xs text-pretty text-muted-foreground">
                  Langsung keluar dari semua perangkat. Riwayatnya tetap ada.
                </span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(true)}
                  className="w-fit hover:underline disabled:opacity-50"
                >
                  Aktifkan lagi
                </button>
                <span className="text-xs text-muted-foreground">Bisa masuk lagi setelah ini.</span>
              </>
            )}
          </div>
        )}

        {failed && (
          <Alert>
            {lastAdministrator
              ? "Harus tetap ada satu administrator aktif untuk semua sekolah."
              : "Perubahan belum tersimpan. Coba lagi sebentar lagi."}
          </Alert>
        )}
      </div>
      <SheetFooter className="flex-row justify-end">
        <Button type="button" variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" disabled={save.isPending} focusableWhenDisabled>
          {save.isPending ? "Menyimpan…" : "Simpan"}
        </Button>
      </SheetFooter>
    </form>
  );
}
