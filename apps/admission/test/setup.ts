import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// The first screen of a file waits for its route to be compiled, which takes
// seconds on a machine running every suite at once.
configure({ asyncUtilTimeout: 10_000 });

// jsdom has no layout, so these are missing and their callers only need them to exist.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
Object.assign(document, { elementFromPoint: () => null });
globalThis.scrollTo = () => {};

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
