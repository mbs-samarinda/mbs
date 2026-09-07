import { createFileRoute } from "@tanstack/react-router";

import { signInAsSomebodyElse } from "../auth.ts";
import { Gate } from "../components/gate.tsx";

// Where Better Auth sends a rejected sign-in, and where the guard sends a
// session that resolves to no staff profile. It never says whether an address
// is known or who the committee are: a failed sign-in must not become a way to
// probe the staff list.
export const Route = createFileRoute("/access-denied")({
  component: () => (
    <Gate
      title="Akun ini tidak punya akses"
      body="Minta administrator panitia mendaftarkan alamat @mbss.sch.id Anda."
      actionLabel="Masuk dengan akun lain"
      onAction={signInAsSomebodyElse}
    />
  ),
});
