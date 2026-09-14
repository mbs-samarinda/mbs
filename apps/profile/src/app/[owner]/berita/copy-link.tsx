"use client";

import { useState } from "react";

/**
 * Copies the article's address, and says it did.
 *
 * The one client component on a content page. Everything around it — WhatsApp,
 * email — is a plain link that works with no JavaScript at all, and this row is
 * the enhancement: without a clipboard the label never changes, and the address
 * is still in the browser's own bar.
 *
 * The confirmation is the label rather than a toast: one piece of state, no
 * portal, nothing to dismiss, and it is read out where the focus already is.
 */
export function CopyLink({ url, className }: { url: string; className: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          // Long enough to read, short enough that a second copy still reports
          // itself. No cleanup on unmount: the timer holds nothing but state on
          // a component the visitor is looking at.
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // A denied clipboard permission is not an error worth a dialog. The
          // address is in the address bar.
        }
      }}
    >
      {/* Announced rather than only recoloured: the label is the whole feedback,
          so a screen reader has to hear it change. */}
      <span aria-live="polite">{copied ? "Tersalin" : "Salin tautan"}</span>
    </button>
  );
}
