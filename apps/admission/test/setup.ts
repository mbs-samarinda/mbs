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
// From Node 25 on, Node's own localStorage, which needs a file, hides jsdom's.
declare const jsdom: { window: Window };
Object.defineProperty(globalThis, "localStorage", {
  value: jsdom.window.localStorage,
  configurable: true,
});
Object.assign(document, { elementFromPoint: () => null });
globalThis.scrollTo = () => {};

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  // The draft is kept in memory too, as it is when the device blocks storage.
  dispatchEvent(new StorageEvent("storage", { key: null }));
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
