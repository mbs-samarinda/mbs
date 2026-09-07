import { createFileRoute } from "@tanstack/react-router";

import { signInAsSomebodyElse } from "../auth.ts";
import { Gate } from "../components/gate.tsx";

// An approved, active staff member with no school assigned. Every queue would
// be empty and every action refused, so they get told what is missing instead
// of a product that looks broken.
export const Route = createFileRoute("/no-schools")({
  component: () => (
    <Gate
      title="Belum ada sekolah untuk Anda"
      body="Administrator panitia perlu menugaskan sekolah sebelum Anda bisa membuka antrean."
      actionLabel="Masuk dengan akun lain"
      onAction={signInAsSomebodyElse}
    />
  ),
});
