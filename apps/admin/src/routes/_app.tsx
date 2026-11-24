import { signOut } from "@mbs/api-client/auth";
import { UnreachableError } from "@mbs/api-client/http";
import { SCHOOL_KEYS, type SchoolKey } from "@mbs/school-config";
import { Alert } from "@mbs/ui/components/alert";
import { BrandMark } from "@mbs/ui/components/brand-mark";
import { Button } from "@mbs/ui/components/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@mbs/ui/components/sheet";
import { StatusPage } from "@mbs/ui/components/status-page";
import { ThemeSelect } from "@mbs/ui/components/theme-select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { cn } from "cn";
import { HomeIcon, InboxIcon, MenuIcon, UsersIcon } from "lucide-react";
import { useState } from "react";

import { APP_NAME } from "../app-name.ts";
import { schoolMarkClass, schoolShortName, Tile } from "../committee-ui.tsx";
import { formatCount } from "../format.ts";
import { dashboardQuery, visitorQuery } from "../staff.ts";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const failed = leave.error && (
    <Alert>
      {leave.error instanceof UnreachableError
        ? "Server tidak bisa dihubungi. Periksa koneksi internet kamu, lalu coba lagi."
        : "Kamu belum keluar. Coba lagi sebentar lagi."}
    </Alert>
  );
  const signOutButton = (
    <Button
      variant="outline"
      disabled={leave.isPending}
      focusableWhenDisabled
      onClick={() => leave.mutate()}
    >
      {leave.isPending ? "Keluar…" : "Keluar"}
    </Button>
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

  const { staff } = visitor;
  const footer = (
    <div className="flex items-center gap-2 px-2 text-sm">
      <Tile name={staff.name} size="sm" />
      <span className="min-w-0 flex-1 truncate font-medium" title={staff.name}>
        {staff.name}
      </span>
      <ThemeSelect size="default" />
      {signOutButton}
    </div>
  );

  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 bg-muted px-3 py-4 max-lg:hidden lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto">
        <div className="px-2">
          <BrandMark sub={APP_NAME} />
        </div>
        <Nav schools={staff.schools} />
        <div className="mt-auto">{footer}</div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 lg:hidden">
          <BrandMark sub={APP_NAME} />
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger render={<Button variant="outline" size="icon" aria-label="Menu" />}>
              <MenuIcon />
            </SheetTrigger>
            <SheetContent side="left" className="gap-6 bg-muted px-3 py-4">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <div className="px-2 pr-10">
                <BrandMark sub={APP_NAME} />
              </div>
              <Nav schools={staff.schools} onNavigate={() => setMenuOpen(false)} />
              <div className="mt-auto">{footer}</div>
            </SheetContent>
          </Sheet>
        </header>
        <main className="grid flex-1 content-start">
          {failed && <div className="px-[min(2rem,5vw)] pt-4">{failed}</div>}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const NAV_ITEM =
  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-background hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:font-medium aria-[current=page]:text-foreground";

/**
 * The router marks a link current on its own, and would mark "Pendaftar" on every
 * filtered list. Exact matching keeps its marks inside the rules below.
 */
const EXACT = { exact: true, includeSearch: true };

const current = (active: boolean) => (active ? ("page" as const) : undefined);
const count = (value: number | undefined) =>
  value !== undefined && <span className="text-xs tabular-nums">{formatCount(value)}</span>;

/** Only the staff member's own schools: a filter for a school they cannot read would show nothing. */
function Nav({ schools, onNavigate }: { schools: readonly SchoolKey[]; onNavigate?: () => void }) {
  const { pathname, search } = useLocation();
  const dashboard = useQuery(dashboardQuery);
  const onList = pathname === "/pendaftar";
  const { tampil, sekolah }: { tampil?: unknown; sekolah?: unknown } = search;
  const ordered = SCHOOL_KEYS.filter((key) => schools.includes(key));

  return (
    <nav aria-label="Utama" className="grid gap-6 text-sm">
      <div className="grid gap-0.5">
        <Link
          to="/"
          activeOptions={EXACT}
          className={NAV_ITEM}
          aria-current={current(pathname === "/")}
          onClick={onNavigate}
        >
          <HomeIcon aria-hidden className="size-4 shrink-0" />
          <span className="flex-1">Beranda</span>
        </Link>
        <Link
          to="/pendaftar"
          activeOptions={EXACT}
          className={NAV_ITEM}
          aria-current={current(onList && tampil === undefined && sekolah === undefined)}
          onClick={onNavigate}
        >
          <UsersIcon aria-hidden className="size-4 shrink-0" />
          <span className="flex-1">Pendaftar</span>
          {count(dashboard.data?.total)}
        </Link>
        <Link
          to="/pendaftar"
          activeOptions={EXACT}
          search={{ tampil: "perlu" }}
          className={NAV_ITEM}
          aria-current={current(onList && tampil === "perlu")}
          onClick={onNavigate}
        >
          <InboxIcon aria-hidden className="size-4 shrink-0" />
          <span className="flex-1">Perlu dicek</span>
          {count(dashboard.data?.needsCommittee)}
        </Link>
      </div>
      {ordered.length > 0 && (
        <div className="grid gap-0.5">
          <h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">Sekolah</h2>
          {ordered.map((key) => (
            <Link
              key={key}
              to="/pendaftar"
              search={{ sekolah: key }}
              activeOptions={EXACT}
              className={cn(NAV_ITEM, "text-foreground")}
              aria-current={current(onList && sekolah === key)}
              onClick={onNavigate}
            >
              <span
                aria-hidden
                className={cn("size-2.5 shrink-0 rounded-[3px]", schoolMarkClass(key))}
              />
              <span className="min-w-0 flex-1 truncate">{schoolShortName(key)}</span>
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
