import { Button, buttonVariants } from "@mbs/ui/components/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@mbs/ui/components/input-otp";
import { Label } from "@mbs/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { cn } from "cn";
import { CircleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { accountQuery } from "../account.ts";
import {
  CODE_LENGTH,
  explain,
  pendingEmail,
  requestCode,
  setPendingEmail,
  signInWithCode,
} from "../email-code.ts";
import { useSingleFlight } from "../use-single-flight.ts";

export const Route = createFileRoute("/masuk/kode")({
  beforeLoad: ({ search }) => {
    const email = pendingEmail();
    if (email === null) throw redirect({ to: "/masuk", search, replace: true });
    return { email };
  },
  component: CodeStep,
});

function CodeStep() {
  const { email } = Route.useRouteContext();
  const search = Route.useSearch();
  const router = useRouter();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");

  const signIn = useMutation({
    mutationFn: (otp: string) => signInWithCode(email, otp),
    onSuccess: async (account) => {
      setPendingEmail(null);
      // A check that started before this may answer "signed out" after it.
      await queryClient.cancelQueries({ queryKey: accountQuery.queryKey });
      if (account) {
        queryClient.setQueryData(accountQuery.queryKey, account);
      } else {
        // The code is used up, so this screen has nothing left to offer. The page
        // asked for fetches the account itself and can be tried again.
        queryClient.removeQueries({ queryKey: accountQuery.queryKey });
        router.history.replace(search.lanjut ?? "/");
      }
    },
    // The boxes keep the digits to compare with the email. Selecting them lets
    // the next digit start over.
    onError: (error) => {
      if (explain(error).next !== "RETRY") input.current?.setSelectionRange(0, CODE_LENGTH);
    },
  });
  const resend = useMutation({
    mutationFn: () => requestCode(email),
    onSuccess: () => {
      signIn.reset();
      setCode("");
      input.current?.focus();
    },
  });

  useEffect(() => input.current?.focus(), []);

  const signInOnce = useSingleFlight(signIn);
  const resendOnce = useSingleFlight(resend);
  const submit = (otp: string) => {
    if (signIn.isSuccess || otp.length < CODE_LENGTH) return;
    resend.reset();
    signInOnce(otp);
  };

  const refusal = signIn.error && explain(signIn.error);
  const failure = resend.error ? explain(resend.error) : refusal;
  const busy = signIn.isPending || signIn.isSuccess;
  return (
    <>
      <div className="grid gap-2">
        <h1 tabIndex={-1} className="text-2xl font-semibold text-balance outline-none">
          Periksa email kamu
        </h1>
        <p id="code-sent" className="text-pretty text-muted-foreground">
          Kami mengirim kode ke{" "}
          <span className="font-medium wrap-anywhere text-foreground">{email}</span>. Kode berlaku 5
          menit.
        </p>
      </div>
      <form
        className="grid grid-cols-1 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit(code);
        }}
      >
        <Label htmlFor="code">Kode 6 angka</Label>
        <InputOTP
          ref={input}
          id="code"
          name="code"
          maxLength={CODE_LENGTH}
          pattern="^[0-9]*$"
          pasteTransformer={(text) => text.replace(/\D/g, "")}
          value={code}
          // Not `onComplete`, which stays silent when six digits replace six.
          onChange={(value) => {
            if (busy || value === code) return;
            setCode(value);
            signIn.reset();
            submit(value);
          }}
          readOnly={busy}
          aria-invalid={refusal && refusal.next !== "RETRY" ? true : undefined}
          aria-describedby="code-sent code-status"
        >
          <InputOTPGroup>
            {Array.from({ length: CODE_LENGTH }, (_, index) => (
              // oxlint-disable-next-line react/no-array-index-key
              <InputOTPSlot key={index} index={index} />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <div id="code-status" className="min-h-5 text-sm">
          <div role="alert">
            {failure && (
              <p className="flex items-start gap-1.5 text-destructive">
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 text-pretty">{failure.message}</span>
              </p>
            )}
          </div>
          <output className="block text-muted-foreground">
            {busy ? "Memeriksa kode…" : resend.isSuccess ? "Kode baru sudah dikirim." : null}
          </output>
        </div>
        {refusal?.next === "RETRY" && !resend.error && (
          <Button type="submit" size="touch">
            Coba lagi
          </Button>
        )}
      </form>
      <div className="flex flex-wrap justify-between gap-x-4">
        <Button
          variant="link"
          size="touch"
          className="px-0"
          disabled={resend.isPending || busy}
          focusableWhenDisabled
          onClick={() => resendOnce()}
        >
          {resend.isPending ? "Mengirim kode…" : "Kirim kode baru"}
        </Button>
        <Link
          to="/masuk"
          search={search}
          className={cn(
            buttonVariants({ variant: "link", size: "touch" }),
            "px-0 text-muted-foreground",
          )}
        >
          Ganti email
        </Link>
      </div>
    </>
  );
}
