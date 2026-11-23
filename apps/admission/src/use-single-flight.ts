import type { UseMutationResult } from "@tanstack/react-query";
import { useRef } from "react";

/**
 * Drops a press while the last one is still running. `isPending` cannot do it:
 * it arrives a moment late, and a fast second tap would spend a second code.
 */
export function useSingleFlight<Data, Variables>(
  mutation: Pick<UseMutationResult<Data, Error, Variables>, "mutateAsync">,
) {
  const running = useRef(false);
  return (variables: Variables) => {
    if (running.current) return;
    running.current = true;
    // The promise, not `mutate`'s own callbacks, which a reset would drop. The
    // error is on the mutation, where the screen reads it.
    void mutation
      .mutateAsync(variables)
      .catch(() => undefined)
      .finally(() => {
        running.current = false;
      });
  };
}
