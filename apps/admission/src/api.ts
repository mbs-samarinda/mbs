import { createApiClient } from "@mbs/api-client/rpc";
import { queryOptions } from "@tanstack/react-query";

export const api = createApiClient();

// The account id is in the key, so one account never reads what another cached.

export const applicationsQuery = (accountId: string) =>
  queryOptions({
    queryKey: ["applications", accountId],
    queryFn: () => api.applicant.applications.list(),
  });

export const applicationQuery = (accountId: string, applicationId: string) =>
  queryOptions({
    queryKey: ["applications", accountId, applicationId],
    queryFn: () => api.applicant.applications.get({ applicationId }),
  });

export const paymentQuery = (accountId: string, applicationId: string) =>
  queryOptions({
    queryKey: ["payments", accountId, applicationId],
    queryFn: () => api.applicant.payments.get({ applicationId }),
  });
