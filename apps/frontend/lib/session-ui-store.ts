"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type RightPanelTab = "changes" | "preview";

type SessionUIState = {
  activeSessionId: string | null;
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab;
  rightPanelWidth: number;
  selectSession: (id: string | null) => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setRightPanelWidth: (width: number) => void;
  resetSessionUI: () => void;
};

const DEFAULT_PANEL_WIDTH = 40;

type PersistedSessionUIState = Pick<
  SessionUIState,
  "activeSessionId" | "rightPanelOpen" | "rightPanelTab" | "rightPanelWidth"
>;

const storage = createJSONStorage<PersistedSessionUIState>(() => localStorage);

export const useSessionUIStore = create<SessionUIState>()(
  persist(
    (set) => ({
      activeSessionId: null,
      rightPanelOpen: true,
      rightPanelTab: "changes",
      rightPanelWidth: DEFAULT_PANEL_WIDTH,
      selectSession: (activeSessionId) => set({ activeSessionId }),
      setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
      setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
      setRightPanelWidth: (rightPanelWidth) => set({ rightPanelWidth }),
      resetSessionUI: () => set({ rightPanelTab: "changes" }),
    }),
    {
      name: "opendevin:session-ui",
      storage,
      partialize: ({
        activeSessionId,
        rightPanelOpen,
        rightPanelTab,
        rightPanelWidth,
      }) => ({ activeSessionId, rightPanelOpen, rightPanelTab, rightPanelWidth }),
    },
  ),
);

export const sessionUISelectors = {
  activeSessionId: (state: SessionUIState) => state.activeSessionId,
  rightPanelOpen: (state: SessionUIState) => state.rightPanelOpen,
  rightPanelTab: (state: SessionUIState) => state.rightPanelTab,
  rightPanelWidth: (state: SessionUIState) => state.rightPanelWidth,
  selectSession: (state: SessionUIState) => state.selectSession,
  setRightPanelOpen: (state: SessionUIState) => state.setRightPanelOpen,
  setRightPanelTab: (state: SessionUIState) => state.setRightPanelTab,
  setRightPanelWidth: (state: SessionUIState) => state.setRightPanelWidth,
  resetSessionUI: (state: SessionUIState) => state.resetSessionUI,
};
