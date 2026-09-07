import { createFileRoute, redirect } from "@tanstack/react-router";

import { api } from "../api.ts";

/**
 * Everything below this route needs a staff identity, so it is resolved once
 * here rather than in each page. This is navigation, not security: the API
 * rechecks the session, the role and the school scope on every call.
 */
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context }) => {
    const staff = await context.queryClient
      .query(api.staff.me.get.queryOptions())
      .catch((error: unknown) => {
        const code =
          typeof error === "object" && error !== null && "code" in error ? error.code : null;

        // Not signed in at all versus signed in as somebody the committee does
        // not recognise. The second is a dead end, not a login prompt: sending
        // them back to sign in would loop.
        if (code === "UNAUTHORIZED") throw redirect({ to: "/sign-in" });
        if (code === "FORBIDDEN") throw redirect({ to: "/access-denied" });
        throw error;
      });

    // A role grants nothing without a school, so there is no usable page to
    // send them to.
    if (staff.schools.length === 0) throw redirect({ to: "/no-schools" });

    return { staff };
  },
});
