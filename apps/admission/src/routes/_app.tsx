import { signOut } from "@mbs/api-client/auth";
import { Alert } from "@mbs/ui/components/alert";
import { BrandMark } from "@mbs/ui/components/brand-mark";
import { Button } from "@mbs/ui/components/button";
import { ThemeSelect } from "@mbs/ui/components/theme-select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { accountQuery } from "../account.ts";
import { APP_NAME } from "../app-name.ts";
import { clearDraft } from "../draft.ts";
import { explain } from "../email-code.ts";
import { InShell } from "../in-shell.ts";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const account = await context.queryClient.fetchQuery(accountQuery);
    if (account) return { account };

    // Better Auth sends a Google sign-in it cannot place to `/?error=`.
    const { error }: { error?: unknown } = location.search;
    throw redirect({
      to: "/masuk",
      search:
        typeof error === "string"
          ? { error }
          : location.href === "/"
            ? {}
            : { lanjut: location.href },
      replace: true,
    });
  },
  component: AppShell,
});

function AppShell() {
  const { account } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const leave = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      clearDraft();
      queryClient.clear();
      queryClient.setQueryData(accountQuery.queryKey, null);
      return navigate({ to: "/masuk", replace: true });
    },
  });

  // A sign-in or sign-out in another tab changes whose pages these are.
  const { data: now } = useQuery({ ...accountQuery, refetchOnWindowFocus: "always" });
  const changed = now !== undefined && now?.id !== account.id;
  const leaving = leave.isPending || leave.isSuccess;
  useEffect(() => {
    if (changed && !leaving) void router.invalidate();
  }, [changed, leaving, router]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-[min(1.25rem,6vw)]">
      <header className="flex flex-wrap items-center gap-2 py-5">
        {/* The name wraps before the buttons drop to a row of their own. */}
        <div className="min-w-0 flex-1 basis-48">
          <BrandMark sub={APP_NAME} />
        </div>
        <div className="-mr-[min(1rem,6vw)] ml-auto flex items-center">
          <ThemeSelect size="touch" />
          <Button
            variant="ghost"
            size="touch"
            disabled={leave.isPending}
            focusableWhenDisabled
            onClick={() => leave.mutate()}
          >
            {leave.isPending ? "Keluar…" : "Keluar"}
          </Button>
        </div>
      </header>
      {leave.error && <Alert>{explain(leave.error).message}</Alert>}
      <main className="grid flex-1 grid-cols-1 content-start gap-8 pt-4 pb-10">
        <InShell value={true}>
          <Outlet />
        </InShell>
      </main>
      <footer className="border-t border-border py-5">
        <p className="text-sm wrap-anywhere text-muted-foreground">
          Kamu masuk sebagai <span className="font-medium text-foreground">{account.email}</span>
        </p>
      </footer>
    </div>
  );
}
