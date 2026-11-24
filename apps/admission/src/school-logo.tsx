import type { SchoolKey } from "@mbs/school-config";
import { cn } from "cn";

import sma from "./assets/logo-sma.webp";
import smk from "./assets/logo-smk.webp";
import smp from "./assets/logo-smp.webp";

const LOGOS: Record<SchoolKey, string> = { smp, smk, sma };

/** Beside the school's name, so it adds nothing to say. Keeps its white ground on a dark page. */
export function SchoolLogo({ school, className }: { school: SchoolKey; className: string }) {
  return (
    <img
      src={LOGOS[school]}
      alt=""
      width={56}
      height={56}
      className={cn("shrink-0 rounded-lg bg-white object-contain", className)}
    />
  );
}
