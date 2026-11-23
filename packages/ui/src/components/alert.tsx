import { cn } from "cn";
import { CircleAlertIcon } from "lucide-react";
import type { ComponentProps } from "react";

/** A failure that belongs to no field. A field's own error goes under the field. */
function Alert({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg bg-destructive-tint px-3 py-2.5 text-sm text-pretty text-destructive",
        className,
      )}
      {...props}
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="grid min-w-0 gap-1">{children}</div>
    </div>
  );
}

export { Alert };
