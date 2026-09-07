import { createFileRoute } from "@tanstack/react-router";

import { signInWithGoogle } from "../auth.ts";
import { Gate } from "../components/gate.tsx";

export const Route = createFileRoute("/sign-in")({
  component: () => (
    <Gate
      title="Panitia Penerimaan"
      body="Masuk dengan akun @mbss.sch.id Anda."
      actionLabel="Masuk dengan Google"
      onAction={signInWithGoogle}
    />
  ),
});
