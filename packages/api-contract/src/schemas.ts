import { z } from "zod";

/** School keys are fixed organisational facts, not tenant rows. */
export const SchoolKey = z.enum(["sma", "smp", "sd"]);
export type SchoolKey = z.infer<typeof SchoolKey>;

export const CycleStatus = z.enum(["DRAFT", "OPEN", "CLOSED", "ARCHIVED"]);
export type CycleStatus = z.infer<typeof CycleStatus>;

/**
 * The cycle is global across MBSS and carries no school. A school is enabled
 * for it and may override the fee, so the public view is resolved per school:
 * effective fee is `feeOverride ?? defaultFee`.
 */
export const PublicAdmissionCycle = z.object({
  id: z.uuid(),
  name: z.string(),
  status: CycleStatus,
  registrationOpenAt: z.iso.datetime(),
  registrationCloseAt: z.iso.datetime(),
  resultPublishAt: z.iso.datetime(),
  schoolKey: SchoolKey,
  isEnabled: z.boolean(),
  effectiveFee: z.int().nonnegative(),
});
export type PublicAdmissionCycle = z.infer<typeof PublicAdmissionCycle>;
