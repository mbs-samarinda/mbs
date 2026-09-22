import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { THEME_SCRIPT } from "./theme-script-content.ts";

describe("theme script", () => {
  it("follows system theme changes unless the visitor chose a theme", () => {
    let systemIsDark = false;
    let onSystemChange: (() => void) | undefined;
    let appliedIsDark = false;
    const document = {
      cookie: "theme=system",
      documentElement: {
        classList: { toggle: (_className: string, enabled: boolean) => (appliedIsDark = enabled) },
        style: { colorScheme: "" },
      },
    };

    vm.runInNewContext(THEME_SCRIPT, {
      decodeURIComponent,
      document,
      matchMedia: () => ({
        get matches() {
          return systemIsDark;
        },
        addEventListener: (_event: string, listener: () => void) => (onSystemChange = listener),
      }),
    });

    expect(appliedIsDark).toBe(false);
    systemIsDark = true;
    onSystemChange?.();
    expect(appliedIsDark).toBe(true);

    document.cookie = "theme=light";
    onSystemChange?.();
    expect(appliedIsDark).toBe(false);
  });
});
