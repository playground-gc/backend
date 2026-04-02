/**
 * @file authStore.js
 * @description Zustand store for auth token and user identity. Persists to localStorage.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'synthetic-bull/auth';

const loadPersisted = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, username: null, userId: null };
    const parsed = JSON.parse(raw);
    return {
      token: parsed.token || null,
      username: parsed.username || null,
      userId: parsed.userId || null,
    };
  } catch (err) {
    console.warn('Failed to parse auth storage', err);
    return { token: null, username: null, userId: null };
  }
};

export const useAuthStore = create((set) => ({
  ...loadPersisted(),
  setAuth: ({ token, username, userId }) => {
    const next = { token, username, userId };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    set(next);
  },
  clearAuth: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, username: null, userId: null });
  },
}));
