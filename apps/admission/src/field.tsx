import { Input } from "@mbs/ui/components/input";
import { Label } from "@mbs/ui/components/label";
import { CircleAlertIcon } from "lucide-react";
import type { ComponentProps } from "react";

export const CONTROL = "h-11 rounded-xl px-3.5";
/** Above what the rules allow, so a long paste is answered and not cut in silence. */
const MAX_LENGTH = 400;

export function TextField({
  field,
  label,
  hint,
  error,
  ...input
}: {
  field: string;
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

export function describedBy(
  field: string,
  { error, hint }: { error: string | undefined; hint?: string | undefined },
) {
  const ids = [error && `${field}-error`, hint && `${field}-hint`].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function FieldError({ field, children }: { field: string; children: string | undefined }) {
  if (!children) return null;
  return (
    <p id={`${field}-error`} className="flex items-start gap-1.5 text-sm text-destructive">
      <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 text-pretty">{children}</span>
    </p>
  );
}
