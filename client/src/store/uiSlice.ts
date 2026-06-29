import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type Theme = "light" | "dark";
export type HelpTab = "user" | "mcp";
export type HelpLang = "en" | "th";
export type ToastKind = "info" | "success" | "error";
export type SseStatus = "connecting" | "connected" | "reconnecting" | "offline";

export interface UiState {
  theme: Theme;
  helpOpen: boolean;
  helpTab: HelpTab;
  helpLang: HelpLang;
  activityLogOpen: boolean;
  accountOpen: boolean;
  usersAdminOpen: boolean;
  /** Knowledge id whose public-share dialog is open, or null when closed. */
  shareKnowledgeId: number | null;
  toast: { message: string; kind: ToastKind; ts: number } | null;
  /** Whether the project-filter modal is open. The selection itself lives in
   *  the URL (`?projects=`), not in Redux — see hooks/useHash.ts. */
  projectFilterOpen: boolean;
  /** Live state of the /api/events SSE channel. */
  sseStatus: SseStatus;
}

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem("wikikai-theme");
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    /* SSR / private mode */
  }
  // First-time visitors land on light. The theme toggle still works
  // and the choice persists to localStorage so returning users keep
  // whatever they picked.
  return "light";
}

function initialHelpLang(): HelpLang {
  try {
    const stored = localStorage.getItem("wikikai-help-lang");
    if (stored === "en" || stored === "th") return stored;
  } catch {
    /* ignore */
  }
  return "en";
}

const initialState: UiState = {
  theme: initialTheme(),
  helpOpen: false,
  helpTab: "user",
  helpLang: initialHelpLang(),
  activityLogOpen: false,
  accountOpen: false,
  usersAdminOpen: false,
  shareKnowledgeId: null,
  toast: null,
  projectFilterOpen: false,
  sseStatus: "connecting",
};

export const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setTheme(state, action: PayloadAction<Theme>) {
      state.theme = action.payload;
      try {
        localStorage.setItem("wikikai-theme", action.payload);
      } catch {
        /* ignore */
      }
    },
    toggleTheme(state) {
      const next = state.theme === "dark" ? "light" : "dark";
      state.theme = next;
      try {
        localStorage.setItem("wikikai-theme", next);
      } catch {
        /* ignore */
      }
    },
    openHelp(state, action: PayloadAction<HelpTab | undefined>) {
      state.helpOpen = true;
      if (action.payload) state.helpTab = action.payload;
    },
    setHelpTab(state, action: PayloadAction<HelpTab>) {
      state.helpTab = action.payload;
    },
    setHelpLang(state, action: PayloadAction<HelpLang>) {
      state.helpLang = action.payload;
      try {
        localStorage.setItem("wikikai-help-lang", action.payload);
      } catch {
        /* ignore */
      }
    },
    closeHelp(state) {
      state.helpOpen = false;
    },
    openActivityLog(state) {
      state.activityLogOpen = true;
    },
    closeActivityLog(state) {
      state.activityLogOpen = false;
    },
    openAccount(state) {
      state.accountOpen = true;
    },
    closeAccount(state) {
      state.accountOpen = false;
    },
    openUsersAdmin(state) {
      state.usersAdminOpen = true;
    },
    closeUsersAdmin(state) {
      state.usersAdminOpen = false;
    },
    openShareModal(state, action: PayloadAction<number>) {
      state.shareKnowledgeId = action.payload;
    },
    closeShareModal(state) {
      state.shareKnowledgeId = null;
    },
    showToast(
      state,
      action: PayloadAction<string | { message: string; kind?: ToastKind }>,
    ) {
      const payload =
        typeof action.payload === "string"
          ? { message: action.payload, kind: "info" as ToastKind }
          : { message: action.payload.message, kind: action.payload.kind ?? "info" };
      state.toast = { ...payload, ts: Date.now() };
    },
    clearToast(state) {
      state.toast = null;
    },
    openProjectFilter(state) {
      state.projectFilterOpen = true;
    },
    closeProjectFilter(state) {
      state.projectFilterOpen = false;
    },
    setSseStatus(state, action: PayloadAction<SseStatus>) {
      state.sseStatus = action.payload;
    },
  },
});

export const {
  setTheme,
  toggleTheme,
  openHelp,
  closeHelp,
  setHelpTab,
  setHelpLang,
  openActivityLog,
  closeActivityLog,
  openAccount,
  closeAccount,
  openUsersAdmin,
  closeUsersAdmin,
  openShareModal,
  closeShareModal,
  showToast,
  clearToast,
  openProjectFilter,
  closeProjectFilter,
  setSseStatus,
} = uiSlice.actions;
