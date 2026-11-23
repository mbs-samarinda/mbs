import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import * as React from "react";

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "default" | "touch";
};

function NativeSelect({ className, size = "default", ...props }: NativeSelectProps) {
  return (
    <div
      className={cn("relative w-fit has-[select:disabled]:opacity-50", className)}
      data-slot="native-select-wrapper"
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-sm transition-colors select-none disabled:pointer-events-none data-[size=touch]:h-11 data-[size=touch]:rounded-xl data-[size=touch]:pl-3.5 data-[size=touch]:text-base md:data-[size=touch]:text-sm dark:bg-input/30 dark:hover:bg-input/50"
        {...props}
      />
      <ChevronDownIcon
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}

// The system's own colors: an option paints on the browser's menu, not the page.
function NativeSelectOption({ className, ...props }: React.ComponentProps<"option">) {
  return <option className={cn("bg-[Canvas] text-[CanvasText]", className)} {...props} />;
}

export { NativeSelect, NativeSelectOption };
