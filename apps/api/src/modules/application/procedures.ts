import { familyProcedure } from "../../plugins/orpc.ts";
import { loadFamilyApplication } from "./service.ts";

export const getApplicantApplicationProcedure = familyProcedure.applicant.applications.get.handler(
  async ({ input, context }) => {
    const application = await loadFamilyApplication(
      context.db,
      context.family,
      input.applicationId,
    );
    return {
      id: application.id,
      registrationNumber: application.registrationNumber,
      schoolKey: application.schoolKey,
      stage: application.stage,
    };
  },
);
