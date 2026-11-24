import { createContext } from "react";

/** Whether the app's header is already around this, so a message page leaves out its own. */
export const InShell = createContext(false);
