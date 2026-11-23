import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

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
