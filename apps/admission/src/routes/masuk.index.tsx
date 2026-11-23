import { googleSignInUrl } from "@mbs/api-client/auth";
import { UnreachableError } from "@mbs/api-client/http";
import { Alert } from "@mbs/ui/components/alert";
import { Button, buttonVariants } from "@mbs/ui/components/button";
import { GoogleButton } from "@mbs/ui/components/google-button";
import { Input } from "@mbs/ui/components/input";
import { Label } from "@mbs/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { CircleAlertIcon } from "lucide-react";
import { useEffect, useRef, type FormEvent } from "react";

import { accountQuery } from "../account.ts";
import { explain, pendingEmail, requestCode, setPendingEmail } from "../email-code.ts";

export const Route = createFileRoute("/masuk/")({ component: EmailStep });

function EmailStep() {
  return (
    <>
      <h1 tabIndex={-1} className="text-2xl font-semibold text-balance outline-none">
        Mulai atau lanjutkan pendaftaran
      </h1>
      <Google />
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        atau pakai email
        <span className="h-px flex-1 bg-border" />
      </div>
      <EmailForm />
    </>
  );
}

function Google() {
  const { lanjut, error } = Route.useSearch();
  const account = useQuery(accountQuery);
  const google = useMutation({
    mutationFn: () =>
      googleSignInUrl({
        returnTo: lanjut ?? "/",
        errorTo: lanjut ? `/masuk?lanjut=${encodeURIComponent(lanjut)}` : "/masuk",
      }),
    onSuccess: (url) => location.assign(url),
  });
  const { reset } = google;

  // The button waits until the browser leaves. Coming back restores this page as
  // it was left, with the button still waiting.
  useEffect(() => {
    const onReturn = (event: PageTransitionEvent) => event.persisted && reset();
    addEventListener("pageshow", onReturn);
    return () => removeEventListener("pageshow", onReturn);
  }, [reset]);

  const busy = google.isPending || google.isSuccess;
  const unreachable = account.error instanceof UnreachableError;
  return (
    <div className="grid gap-4">
      {google.error ? (
        <Alert>{explain(google.error).message}</Alert>
      ) : unreachable ? (
        <Alert>
          Server tidak bisa dihubungi. Periksa koneksi internet kamu.
          <Button
            variant="link"
            size="touch"
            className="justify-self-start px-0 text-destructive underline"
            onClick={() => void account.refetch()}
          >
            Coba lagi
          </Button>
        </Alert>
      ) : error ? (
        <Alert>Masuk dengan Google belum berhasil. Coba lagi, atau pakai email.</Alert>
      ) : null}
      <GoogleButton
        size="touch"
        disabled={busy}
        focusableWhenDisabled
        onClick={() => google.mutate()}
      >
        {busy ? "Membuka Google…" : "Lanjutkan dengan Google"}
      </GoogleButton>
    </div>
  );
}

function EmailForm() {
  // Without `error`, so an old Google failure is not carried to the next step.
  const { lanjut } = Route.useSearch();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const send = useMutation({
    mutationFn: requestCode,
    onSuccess: (_, email) => {
      setPendingEmail(email);
      return navigate({ to: "/masuk/kode", search: { lanjut } });
    },
    onError: () => input.current?.focus(),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (send.isPending) return;
    send.mutate(input.current?.value.trim() ?? "");
  };

  const failure = send.error ? explain(send.error) : null;
  return (
    <form noValidate onSubmit={submit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="email">Alamat email</Label>
        <Input
          ref={input}
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={pendingEmail() ?? ""}
          placeholder="cth. nama@email.com"
          aria-invalid={failure ? true : undefined}
          aria-describedby="email-error"
          className="h-11 rounded-xl px-3.5"
        />
        <div id="email-error" role="alert" className="empty:absolute">
          {failure && (
            <p className="flex items-start gap-1.5 text-sm text-destructive">
              <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 text-pretty">{failure.message}</span>
            </p>
          )}
        </div>
        {failure?.hasUsableCode && (
          <Link
            to="/masuk/kode"
            search={{ lanjut }}
            onClick={() => setPendingEmail(send.variables ?? null)}
            className={cn(buttonVariants({ variant: "outline", size: "touch" }))}
          >
            Masukkan kode terakhir
          </Link>
        )}
      </div>
      <Button type="submit" size="touch" disabled={send.isPending} focusableWhenDisabled>
        {send.isPending ? "Mengirim kode…" : "Kirim kode masuk"}
      </Button>
    </form>
  );
}
