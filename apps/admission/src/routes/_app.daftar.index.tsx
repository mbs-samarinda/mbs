import { createFileRoute, redirect } from "@tanstack/react-router";

import { openForm } from "../registration.ts";

export const Route = createFileRoute("/_app/daftar/")({
  beforeLoad: async ({ context }) => {
    const { firstOpen } = await openForm(context);
    throw redirect({ to: "/daftar/$langkah", params: { langkah: firstOpen }, replace: true });
  },
});
