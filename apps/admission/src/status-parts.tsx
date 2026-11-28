import type { FamilyApplicationSummary, FamilyStage } from "@mbs/api-contract";
import { MILESTONES, type FinishedMilestones } from "@mbs/school-config";
import { formatDayAndMonth } from "@mbs/school-config/format";
import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { schoolName } from "./format.ts";
import { SchoolLogo } from "./school-logo.tsx";
import { MILESTONE_LABELS, STAGE_COPY } from "./stage-copy.ts";

/** Whose application this is, as the page's heading. */
export function ApplicationHeader({
  application,
}: {
  application: Pick<FamilyApplicationSummary, "childName" | "schoolKey" | "registrationNumber">;
}) {
  return (
    // The name drops under the logo when large text leaves it no room.
    <div className="flex flex-wrap items-start gap-4">
      <SchoolLogo school={application.schoolKey} className="size-14" />
      <div className="min-w-0 flex-[1_1_11rem] wrap-anywhere">
        <h1 tabIndex={-1} className="text-xl font-semibold text-balance outline-none">
          {application.childName}
        </h1>
        <p className="text-sm text-muted-foreground">{schoolName(application.schoolKey)}</p>
        <p className="text-sm text-muted-foreground tabular-nums">
          Nomor pendaftaran{" "}
          <span className="font-medium text-foreground">{application.registrationNumber}</span>
        </p>
      </div>
    </div>
  );
}

export function NextStep({
  turn,
  title,
  children,
}: {
  turn: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-1.5 rounded-xl bg-info-tint p-[min(1.25rem,6vw)] wrap-anywhere">
      <p className="text-sm font-medium text-info">{turn}</p>
      <h2 className="text-lg font-semibold text-balance">{title}</h2>
      {children}
    </section>
  );
}

export function Road({ stage, finished }: { stage: FamilyStage; finished: FinishedMilestones }) {
  const { at } = STAGE_COPY[stage];
  const reached = at === null ? MILESTONES.length : MILESTONES.indexOf(at);
  const road = MILESTONES.map((milestone, index) => ({
    milestone,
    finishedAt: finished[milestone],
    state: index < reached ? "done" : index === reached ? "now" : "next",
  })).filter(
    // A road that ended shows how far it went, not steps that will never come.
    ({ finishedAt }) => at !== null || finishedAt !== undefined,
  );
  return (
    <section className="grid gap-4">
      <h2 className="font-semibold">Tahapan</h2>
      <ol>
        {road.map(({ milestone, finishedAt, state }, index) => (
          <li
            key={milestone}
            aria-current={state === "now" ? "step" : undefined}
            className="relative flex gap-3.5 pb-4 last:pb-0"
          >
            {index < road.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-6 bottom-0 left-[calc(0.75rem-1px)] w-0.5",
                  state === "done" ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <Dot state={state} />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4">
              <span
                className={cn(
                  "min-w-0 wrap-anywhere",
                  state === "now" && "font-semibold",
                  state === "next" && "text-muted-foreground",
                )}
              >
                {MILESTONE_LABELS[milestone]}
                <span className="sr-only">
                  {state === "done" ? ", selesai" : state === "now" ? ", sekarang" : ", berikutnya"}
                </span>
              </span>
              {state === "done" && finishedAt && (
                <time dateTime={finishedAt} className="ml-auto text-sm text-muted-foreground">
                  {formatDayAndMonth(finishedAt)}
                </time>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Dot({ state }: { state: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full",
        state === "done" && "bg-primary text-primary-foreground",
        state === "now" && "border-2 border-primary bg-background",
        state === "next" && "border-2 border-border bg-background",
      )}
    >
      {state === "done" && <CheckIcon className="size-3.5" strokeWidth={3} />}
      {state === "now" && <span className="size-2 rounded-full bg-primary" />}
    </span>
  );
}
