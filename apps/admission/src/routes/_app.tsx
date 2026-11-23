import { signOut } from "@mbs/api-client/auth";
import { Alert } from "@mbs/ui/components/alert";
import { BrandMark } from "@mbs/ui/components/brand-mark";
import { Button } from "@mbs/ui/components/button";
import { ThemeSelect } from "@mbs/ui/components/theme-select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";

import { accountQuery } from "../account.ts";
import { APP_NAME } from "../app-name.ts";
import { explain } from "../email-code.ts";

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
  const navigate = useNavigate();
  const leave = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(accountQuery.queryKey, null);
      return navigate({ to: "/masuk", replace: true });
    },
  });

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-[min(1.25rem,6vw)]">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-5">
        <BrandMark sub={APP_NAME} />
        <Button
          variant="ghost"
          size="touch"
          disabled={leave.isPending}
          focusableWhenDisabled
          onClick={() => leave.mutate()}
        >
          {leave.isPending ? "Keluar…" : "Keluar"}
        </Button>
      </header>
      {leave.error && <Alert>{explain(leave.error).message}</Alert>}
      <main className="grid flex-1 content-start gap-8 py-8">
        <Outlet />
      </main>
      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border py-5">
        <p className="text-sm wrap-anywhere text-muted-foreground">
          Kamu masuk sebagai <span className="font-medium text-foreground">{account.email}</span>
        </p>
        <ThemeSelect size="touch" />
      </footer>
    </div>
  );
}
