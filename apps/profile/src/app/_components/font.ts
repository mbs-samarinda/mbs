import localFont from "next/font/local";

// Jakarta for every document this app renders: the root layout and the two
// pages that bring their own <html>.
//
// The same file `@mbs/ui` loads through Fontsource, but through next/font so it
// is preloaded and gets a fallback sized to match, and text does not jump when
// it arrives. Latin only: the rare letter outside it, such as Ā, falls back to
// the system face. The Fontsource faces stay in the shared CSS for the Vite
// apps; nothing here names them, so the browser never downloads them.
export const jakarta = localFont({
  src: "../../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-jakarta",
});
