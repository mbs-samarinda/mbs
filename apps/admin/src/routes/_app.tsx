import { signOut } from "@mbs/api-client/auth";
import { UnreachableError } from "@mbs/api-client/http";
import { Alert } from "@mbs/ui/components/alert";
import { BrandMark } from "@mbs/ui/components/brand-mark";
import { Button } from "@mbs/ui/components/button";
import { StatusPage } from "@mbs/ui/components/status-page";
import { ThemeSelect } from "@mbs/ui/components/theme-select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";

import { APP_NAME } from "../app-name.ts";
import { visitorQuery } from "../staff.ts";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const visitor = await context.queryClient.fetchQuery(visitorQuery);
    if (visitor.kind !== "signed-out") return { visitor };

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

function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(visitorQuery.queryKey, { kind: "signed-out" });
      return navigate({ to: "/masuk", replace: true });
    },
  });
}

function AppShell() {
  const { visitor } = Route.useRouteContext();
  const leave = useSignOut();
  const failed = leave.error && (
    <Alert>
      {leave.error instanceof UnreachableError
        ? "Server tidak bisa dihubungi. Periksa koneksi internet kamu, lalu coba lagi."
        : "Kamu belum keluar. Coba lagi sebentar lagi."}
    </Alert>
  );

  if (visitor.kind === "refused") {
    return (
      <StatusPage
        sub={APP_NAME}
        title="Akun ini belum punya akses"
        body={`Kamu masuk sebagai ${visitor.email}. Keluar, lalu masuk dengan akun lain. Atau minta administrator mendaftarkan akun ini.`}
        actions={
          <>
            <Button disabled={leave.isPending} focusableWhenDisabled onClick={() => leave.mutate()}>
              {leave.isPending ? "Keluar…" : "Keluar"}
            </Button>
            {failed}
          </>
        }
      />
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border px-[min(1.5rem,5vw)] py-2">
        <BrandMark sub={APP_NAME} />
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 text-sm font-medium wrap-anywhere">{visitor.staff.name}</span>
          <ThemeSelect size="default" />
          <Button
            variant="outline"
            disabled={leave.isPending}
            focusableWhenDisabled
            onClick={() => leave.mutate()}
          >
            {leave.isPending ? "Keluar…" : "Keluar"}
          </Button>
        </div>
      </header>
      <main className="grid flex-1 content-start gap-6 px-[min(1.5rem,5vw)] py-6">
        {failed}
        <Outlet />
      </main>
    </div>
  );
}
