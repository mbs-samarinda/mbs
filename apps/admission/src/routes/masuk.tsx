import { safeReturnTarget } from "@mbs/api-client/return-target";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { accountQuery } from "../account.ts";
import { EntryLayout } from "../entry-layout.tsx";

type SignInSearch = { lanjut?: string | undefined; error?: string | undefined };

export const Route = createFileRoute("/masuk")({
  // Both keys are always set. The router lays this over the raw search, so a key
  // left out would let a refused value through.
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    lanjut: safeReturnTarget(search.lanjut, { signInPath: "/masuk" }),
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  head: () => ({ meta: [{ title: "Masuk · Pendaftaran Madina Boarding School" }] }),
  component: SignInLayout,
});

function SignInLayout() {
  const { lanjut = "/" } = Route.useSearch();
  const router = useRouter();
  const account = useQuery({ ...accountQuery, refetchOnWindowFocus: "always" });
  const signedIn = Boolean(account.data);

  // The one way out of these screens, for a code, for a visit that was already
  // signed in, and for a sign-in finished in another tab.
  useEffect(() => {
    if (signedIn) router.history.replace(lanjut);
  }, [signedIn, lanjut, router]);

  return (
    <EntryLayout>
      <Outlet />
    </EntryLayout>
  );
}
