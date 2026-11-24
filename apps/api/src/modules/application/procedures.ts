import { familyProcedure, publicProcedure, staffProcedure } from "../../plugins/orpc.ts";
import {
  addCommitteeNote,
  listForCommittee,
  loadDashboard,
  loadForCommittee,
  recordView,
} from "./committee.ts";
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

export const getDashboardProcedure = staffProcedure.staff.dashboard.get.handler(({ context }) =>
  loadDashboard(context.db, context.staff),
);

export const listCommitteeApplicationsProcedure = staffProcedure.staff.applications.list.handler(
  ({ input, context }) => listForCommittee(context.db, context.staff, input),
);

export const getCommitteeApplicationProcedure = staffProcedure.staff.applications.get.handler(
  ({ input, context }) => loadForCommittee(context.db, context.staff, input.applicationId),
);

export const recordViewProcedure = staffProcedure.staff.applications.recordView.handler(
  ({ input, context }) => recordView(context.db, context.staff, input.applicationId, context.meta),
);

export const addNoteProcedure = staffProcedure.staff.applications.addNote.handler(
  ({ input, context }) =>
    addCommitteeNote(context.db, context.staff, input, context.meta, context.outbox),
);
