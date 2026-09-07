import type { SchoolKey, StaffRole, StaffSummary } from "@mbs/api-contract";
import { SCHOOLS } from "@mbs/school-config";
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
import { Label } from "@mbs/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mbs/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@mbs/ui/components/table";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { api } from "../../api.ts";

export const Route = createFileRoute("/_authenticated/staff")({
  // The API refuses every admin.staff procedure to anyone else; this only keeps
  // a staff member from reaching a page of error messages. Lift it into a
  // shared layout when a second administrator-only page arrives.
  beforeLoad: ({ context }) => {
    if (context.staff.role !== "ADMINISTRATOR") throw redirect({ to: "/" });
  },
  component: StaffAccess,
});

/** The two refusals the service raises for a new profile are both CONFLICT. */
function isConflict(error: unknown) {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === "CONFLICT"
  );
}

function StaffAccess() {
  const queryClient = useQueryClient();
  const staff = useQuery(api.admin.staff.list.queryOptions());
  const [confirming, setConfirming] = useState<StaffSummary | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<{ field: "email" | null; message: string } | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: api.admin.staff.key() });

  const setActive = useMutation(
    api.admin.staff.setActive.mutationOptions({
      onSuccess: () => {
        setConfirming(null);
        return invalidate();
      },
    }),
  );

  const create = useMutation(api.admin.staff.create.mutationOptions({ onSuccess: invalidate }));

  // Resolves true so the form knows whether to clear itself. The rules live in
  // the domain service, so its refusal is the message; both refusals — the
  // institutional domain and the duplicate address — are about the email, so
  // they attach to that field.
  const add = async (values: NewStaff) => {
    setAddError(null);
    try {
      await create.mutateAsync(values);
      setAdding(false);
      return true;
    } catch (error) {
      setAddError({
        field: isConflict(error) ? "email" : null,
        message: error instanceof Error ? error.message : "Gagal menyimpan.",
      });
      return false;
    }
  };

  const rows = staff.data ?? [];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Akses staf</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Peran menentukan tindakan, sekolah menentukan jangkauan.
          </p>
        </div>
        <AddStaffDialog
          open={adding}
          onOpenChange={(open) => {
            setAdding(open);
            if (!open) setAddError(null);
          }}
          onSubmit={add}
          error={addError}
        />
      </div>

      <div className="mt-8">
        {staff.error ? (
          <p role="alert" className="text-sm text-destructive">
            {staff.error.message}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Peran</TableHead>
                <TableHead>Sekolah</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Tindakan</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            {staff.isPending ? (
              <StaffSkeleton />
            ) : (
              /* Fading the rows in bridges the swap from the skeleton. The
                 skeleton already holds the layout, so this is a content change
                 rather than a jump, and 200ms is enough to soften it. */
              <TableBody className="opacity-100 transition-opacity duration-200 ease-out starting:opacity-0">
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      Belum ada staf selain Anda.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((person) => (
                    <TableRow key={person.id}>
                      <TableCell>
                        {/* Colour, not movement: the row settles into its new
                            state instead of flicking when access is switched. */}
                        <span
                          className={`transition-colors duration-150 ease-out ${
                            person.isActive ? "" : "text-muted-foreground"
                          }`}
                        >
                          {person.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {institutionalEmail(person)}
                        </span>
                      </TableCell>
                      <TableCell>{ROLE_LABELS[person.role]}</TableCell>
                      <TableCell>{schoolsText(person)}</TableCell>
                      <TableCell className="text-muted-foreground transition-colors duration-150 ease-out">
                        {statusText(person)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={person.isActive ? "outline" : "secondary"}
                          // Only the row being changed, not all of them.
                          disabled={
                            setActive.isPending && setActive.variables?.staffId === person.id
                          }
                          aria-label={`${person.isActive ? "Nonaktifkan" : "Aktifkan"} ${person.name}`}
                          onClick={() =>
                            person.isActive
                              ? setConfirming(person)
                              : setActive.mutate({ staffId: person.id, isActive: true })
                          }
                        >
                          {person.isActive ? "Nonaktifkan" : "Aktifkan"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            )}
          </Table>
        )}
      </div>

      {/* Reactivation has no dialog, so its refusal has nowhere else to go. */}
      {setActive.error && confirming === null ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {setActive.error.message}
        </p>
      ) : null}

      <DeactivateDialog
        staff={confirming}
        pending={setActive.isPending}
        error={setActive.error ? setActive.error.message : null}
        onCancel={() => {
          setConfirming(null);
          setActive.reset();
        }}
        onConfirm={(person) => setActive.mutate({ staffId: person.id, isActive: false })}
      />
    </main>
  );
}

const ROLE_LABELS: Record<StaffRole, string> = {
  ADMINISTRATOR: "Administrator",
  STAFF: "Staf",
  PRINCIPAL: "Kepala sekolah",
};

const ROLES: StaffRole[] = ["ADMINISTRATOR", "STAFF", "PRINCIPAL"];

const SCHOOL_SHORT: Record<SchoolKey, string> = {
  smp: "SMP",
  smk: "SMK",
  sma: "SMA",
};

function isRole(value: string): value is StaffRole {
  return ROLES.some((role) => role === value);
}

/**
 * One label carrying both whether access works and why it might not. Never
 * colour alone: a deactivated row also reads "Nonaktif".
 */
function statusText(staff: StaffSummary) {
  if (!staff.isActive) return "Nonaktif";
  if (staff.schools.length === 0) return "Tanpa sekolah";
  return staff.loginEmails.some((email) => email.bound) ? "Aktif" : "Belum pernah masuk";
}

function schoolsText(staff: StaffSummary) {
  if (staff.schools.length === 0) return "—";
  if (staff.schools.length === SCHOOLS.length) return "Semua sekolah";
  return staff.schools.map((school) => SCHOOL_SHORT[school]).join(", ");
}

function institutionalEmail(staff: StaffSummary) {
  return staff.loginEmails.find((email) => email.kind === "INSTITUTIONAL")?.email ?? "—";
}

/**
 * Deactivation locks somebody out of every school at once, and the person doing
 * it cannot see the consequence from the row, so it is confirmed.
 *
 * Reactivation is not: it grants back exactly what the profile already
 * describes, and it is undone by the same button.
 */
function DeactivateDialog({
  staff,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  staff: StaffSummary | null;
  pending: boolean;
  /** Refusals belong in here. The dialog stays open, so anything rendered
      behind it is invisible at the moment it matters. */
  error: string | null;
  onCancel: () => void;
  onConfirm: (staff: StaffSummary) => void;
}) {
  return (
    <AlertDialog open={staff !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        {staff ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Nonaktifkan {staff.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Mereka langsung kehilangan akses ke {schoolsText(staff)}. Riwayat tindakan mereka
                tetap tersimpan, dan akses bisa dinyalakan lagi kapan saja.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                aria-busy={pending}
                onClick={() => onConfirm(staff)}
              >
                {pending ? "Menonaktifkan…" : "Nonaktifkan"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

const EMPTY: NewStaff = { name: "", email: "", role: "STAFF", schools: [] };

type NewStaff = {
  name: string;
  email: string;
  role: StaffRole;
  schools: SchoolKey[];
};

/**
 * Adding staff is a decision with four parts, so it gets its own surface rather
 * than a row of controls above the table.
 *
 * The server owns the rules — the institutional domain, the duplicate address —
 * and its message is shown as-is. Repeating them here would be a second copy to
 * keep in sync, and the form would still have to handle being refused. Both of
 * those refusals are about the address, so they attach to that field rather
 * than floating above the buttons.
 */
function AddStaffDialog({
  open,
  onOpenChange,
  onSubmit,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves true when the staff member was created. */
  onSubmit: (staff: NewStaff) => Promise<boolean>;
  error: { field: "email" | null; message: string } | null;
}) {
  const schoolsRef = useRef<HTMLFieldSetElement>(null);

  const form = useForm({
    defaultValues: EMPTY,
    // Clearing only on success keeps a refused address on screen to correct,
    // and is why the form owns the reset rather than the close handler: the
    // parent closing a controlled dialog fires no open-change event.
    onSubmit: async ({ value, formApi }) => {
      if (await onSubmit(value)) formApi.reset();
    },
    // Nothing focuses the failing field on its own, and the school checkboxes
    // are the one thing that can fail here.
    onSubmitInvalid: () => schoolsRef.current?.querySelector("button")?.focus(),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) form.reset();
      }}
    >
      <DialogTrigger render={<Button size="sm">Tambah staf</Button>} />

      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Tambah staf</DialogTitle>
            <DialogDescription>
              Peran menentukan tindakan yang boleh dilakukan, sekolah menentukan jangkauannya.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-4">
            <form.Field name="name">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Nama</Label>
                  <Input
                    id={field.name}
                    required
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="email">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Email institusi</Label>
                  <Input
                    id={field.name}
                    required
                    type="email"
                    spellCheck={false}
                    placeholder="nama@mbss.sch.id"
                    aria-invalid={error?.field === "email" ? true : undefined}
                    aria-describedby={error?.field === "email" ? "email-error" : undefined}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {error?.field === "email" ? (
                    <p id="email-error" className="text-sm text-destructive">
                      {error.message}
                    </p>
                  ) : null}
                </div>
              )}
            </form.Field>

            <form.Field name="role">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Peran</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(value) => {
                      if (typeof value === "string" && isRole(value)) field.handleChange(value);
                    }}
                  >
                    <SelectTrigger id={field.name} className="w-full">
                      {/* Without this the trigger renders the raw enum, "STAFF". */}
                      <SelectValue>
                        {(value: string) => (isRole(value) ? ROLE_LABELS[value] : value)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {ROLE_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>

            <form.Field
              name="schools"
              validators={{
                // Checked on submit, not while typing: the message should
                // appear because the form was sent, not because it is unfinished.
                onSubmit: ({ value }) =>
                  value.length === 0 ? "Pilih minimal satu sekolah." : undefined,
              }}
            >
              {(field) => (
                <fieldset ref={schoolsRef}>
                  {/* A legend is outside its fieldset's grid flow, so a container
                      `gap` never applies to it. Space it explicitly instead. */}
                  <legend className="mb-1.5 text-sm font-medium">Sekolah</legend>
                  <div className="flex flex-wrap gap-5">
                    {SCHOOLS.map((school) => (
                      <Label key={school.key} className="font-normal">
                        <Checkbox
                          checked={field.state.value.includes(school.key)}
                          onCheckedChange={(checked) =>
                            field.handleChange(
                              checked
                                ? [...field.state.value, school.key]
                                : field.state.value.filter((key) => key !== school.key),
                            )
                          }
                        />
                        {SCHOOL_SHORT[school.key]}
                      </Label>
                    ))}
                  </div>
                  {field.state.meta.errors.length > 0 ? (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      {field.state.meta.errors.join(" ")}
                    </p>
                  ) : null}
                </fieldset>
              )}
            </form.Field>
          </div>

          {error && error.field === null ? (
            <p role="alert" className="pb-4 text-sm text-destructive">
              {error.message}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Batal</DialogClose>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                // Submit stays enabled so pressing it explains what is missing,
                // and no spinner: CLAUDE.md rules out continuously repainting
                // motion, so the label carries the busy state.
                <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
                  {isSubmitting ? "Menyimpan…" : "Simpan"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Holds the table's shape while the list loads, so the real rows replace it
 * without the page jumping. Deliberately static: `CLAUDE.md` rules out
 * continuously repainting motion, which is what a pulsing or shimmering
 * skeleton is.
 */
function StaffSkeleton() {
  return (
    <TableBody aria-hidden="true">
      {SKELETON_ROWS.map((width) => (
        <TableRow key={width}>
          <TableCell>
            <span className="block h-3.5 rounded bg-muted" style={{ width }} />
            <span className="mt-1.5 block h-3 w-40 rounded bg-muted" />
          </TableCell>
          <TableCell>
            <span className="block h-3.5 w-20 rounded bg-muted" />
          </TableCell>
          <TableCell>
            <span className="block h-3.5 w-16 rounded bg-muted" />
          </TableCell>
          <TableCell>
            <span className="block h-3.5 w-24 rounded bg-muted" />
          </TableCell>
          <TableCell>
            <span className="ml-auto block h-7 w-24 rounded-md bg-muted" />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}

// Uneven widths so the placeholder reads as names rather than a grid. Distinct
// values, so each row keys on its own width instead of its index.
const SKELETON_ROWS = ["9rem", "7rem", "11rem", "8rem", "10rem"];
