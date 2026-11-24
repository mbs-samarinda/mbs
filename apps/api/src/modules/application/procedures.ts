import { familyProcedure, publicProcedure } from "../../plugins/orpc.ts";
import { listFamilyApplications, loadFamilyApplication, submitApplication } from "./service.ts";
import { checkStatus } from "./status-check.ts";

export const listFamilyApplicationsProcedure = familyProcedure.applicant.applications.list.handler(
  ({ context }) => listFamilyApplications(context.db, context.family),
);

export const getFamilyApplicationProcedure = familyProcedure.applicant.applications.get.handler(
  ({ input, context }) => loadFamilyApplication(context.db, context.family, input.applicationId),
);

export const submitApplicationProcedure = familyProcedure.applicant.applications.submit.handler(
  async ({ input, context }) => {
    const { application } = await submitApplication(
      context.db,
      { ...input, userId: context.family.userId, meta: context.meta },
      context.outbox,
    );
    return { applicationId: application.id };
  },
);

export const checkStatusProcedure = publicProcedure.public.application.checkStatus.handler(
  ({ input, context: { db, session, meta } }) =>
    checkStatus(db, input, {
      userId: session.audience === "FAMILY" ? session.user.id : null,
      meta,
    }),
);
