import { familyProcedure } from "../../plugins/orpc.ts";
import { listFamilyApplications, loadFamilyApplication, submitApplication } from "./service.ts";

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
