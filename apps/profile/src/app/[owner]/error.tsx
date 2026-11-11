"use client";

import { Button } from "@mbs/ui/components/button";

import { ownerFromBrowserHost } from "../../owners.ts";
import { Exception } from "../exception.tsx";

/**
 * A page inside this owner's site failed.
 *
 * The header and footer are still on screen — this boundary sits inside the
 * layout — so the visitor keeps the navigation and the contact details, and
 * only the page body is replaced.
 *
 * An error boundary is a client component, so the owner cannot come from
 * `params` here. It comes from the hostname, which the proxy has already
 * checked; a hostname belonging to nobody never reaches a page.
 */
export default function OwnerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const owner = ownerFromBrowserHost(globalThis.location?.hostname);

  return (
    <Exception
      kind="error"
      code="Gangguan sementara"
      title="Halaman ini sedang tidak bisa ditampilkan"
      body="Bukan kesalahan Anda. Coba muat ulang; bila masih sama, hubungi panitia dengan kode di bawah."
      owner={owner}
      action={
        <Button size="touch" onClick={reset}>
          Coba lagi
        </Button>
      }
      reference={error.digest}
    />
  );
}
