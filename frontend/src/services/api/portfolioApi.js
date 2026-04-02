import { API_BASE_URL, getAuthHeader } from './apiConfig';

/**
 * @file portfolioApi.js
 * @description Fetch current portfolio from server.
 */

export const fetchMe = async () => {
    try {
        const response = await fetch(`${API_BASE_URL}/me`, {
            method: 'GET',
            headers: getAuthHeader()
        });
        const data = await response.json();
        if (response.ok) {
            return { success: true, data };
        } else {
            return { success: false, error: data.detail || data.message || 'Failed to fetch account' };
        }
    } catch (err) {
        console.error('FetchMe API Error:', err);
        return { success: false, error: 'Network failure' };
    }
};

export const fetchPortfolio = async () => {
    try {
        const response = await fetch(`${API_BASE_URL}/portfolio`, {
            method: 'GET',
            headers: getAuthHeader()
        });
        const data = await response.json();
        if (response.ok) {
            // Backend returns array directly
            const holdings = Array.isArray(data) ? data : (data.holdings || []);
            return { success: true, holdings };
        } else {
            return { success: false, error: data.detail || data.message || 'Failed to fetch portfolio' };
        }
    } catch (err) {
        console.error('FetchPortfolio API Error:', err);
        return { success: false, error: 'Network failure' };
    }
};

export const fetchBalanceHistory = async ({ limit } = {}) => {
    try {
        const params = new URLSearchParams();
        if (limit) params.set('limit', String(limit));
        const qs = params.toString();
        const url = qs
            ? `${API_BASE_URL}/my/balance-history?${qs}`
            : `${API_BASE_URL}/my/balance-history`;

        const response = await fetch(url, {
            method: 'GET',
            headers: getAuthHeader()
        });
        const data = await response.json();

        if (response.ok) {
            return { success: true, history: Array.isArray(data) ? data : [] };
        }

        return {
            success: false,
            error: data.detail || data.message || 'Failed to fetch balance history'
        };
    } catch (err) {
        console.error('FetchBalanceHistory API Error:', err);
        return { success: false, error: 'Network failure' };
    }
};

