/**
 * @file portfolioStore.js
 * @description Zustand store for the user's portfolio: available cash, per-asset holdings,
 * and accumulated realised and unrealised P&L values.
 * @exports usePortfolioStore  Zustand hook
 * @note Unrealised P&L should be recomputed reactively when marketStore price changes, not stored.
 */

export const usePortfolioStore = () => ({});
