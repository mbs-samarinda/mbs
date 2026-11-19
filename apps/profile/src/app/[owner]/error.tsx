"use client";

import { Button } from "@mbs/ui/components/button";

import { Exception } from "@/app/_components/exception.tsx";
import { ownerFromBrowserHost } from "@/owners.ts";

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
 *
 * `retry`, not `reset`: the usual cause is the CMS being briefly unreachable,
 * and only `retry` fetches the page from the server again. `reset` redraws
 * the same failed result.
 */
export default function OwnerError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const owner = ownerFromBrowserHost(globalThis.location?.hostname);

  return (
    <Exception
      kind="error"
      code="Gangguan sementara"
      title="Halaman ini sedang tidak bisa ditampilkan"
      body="Bukan kesalahanmu. Coba muat ulang; bila masih sama, hubungi panitia dengan kode di bawah."
      owner={owner}
      action={
        <Button size="touch" onClick={retry}>
          Coba lagi
        </Button>
      }
      reference={error.digest}
    />
  );
}
