import { create } from "zustand";

export const useTutorialStore = create((set) => ({
  runTutorial: false,
  tourKey: 0,
  startTutorial: () => set((s) => ({ runTutorial: true, tourKey: s.tourKey + 1 })),
  stopTutorial: () => set({ runTutorial: false }),
}));
