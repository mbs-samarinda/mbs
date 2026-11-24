import { fetchAccount } from "@mbs/api-client/auth";
import { queryOptions } from "@tanstack/react-query";

import { keepOnlyDraftOf } from "./draft.ts";

export const accountQuery = queryOptions({
  queryKey: ["account"],
  queryFn: async () => {
    const account = await fetchAccount();
    if (account) keepOnlyDraftOf(account.id);
    return account;
  },
});
