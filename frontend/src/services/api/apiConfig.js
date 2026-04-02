/**
 * @file apiConfig.js
 * @description Centralized configuration for REST and WebSocket URLs.
 * Values come from environment variables (see .env / .env.example).
 */

const BACKEND = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const API_BASE_URL = `${BACKEND}/api/v1`;

// WebSocket — only used as a reference; actual WS connections go through
// the Vite dev proxy (/ws → VITE_WS_BASE_URL) to avoid cross-origin issues.
export const WS_BASE_URL = `${import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:8001'}/ws`;

export const getAuthHeader = () => {
    try {
        const raw = localStorage.getItem('synthetic-bull/auth');
        const token = raw ? JSON.parse(raw)?.token : null;
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    } catch {
        return {};
    }
};
