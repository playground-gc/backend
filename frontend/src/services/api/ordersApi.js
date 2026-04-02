import { API_BASE_URL, getAuthHeader } from './apiConfig';

/**
 * @file ordersApi.js
 * @description REST API calls for ordering: place new, delete, and find.
 */

export const placeOrder = async ({ symbol, type, side, price, stop_price, limit_price, quantity }) => {
    try {
        const payload = { symbol, type, side, quantity: parseFloat(quantity) };

        // limit order uses `price`
        if (type === 'limit' && price) payload.price = parseFloat(price);

        // stop_limit / stop_market use `stop_price`; stop_limit also needs `limit_price`
        if ((type === 'stop_limit' || type === 'stop_market') && stop_price) {
            payload.stop_price = parseFloat(stop_price);
        }
        if (type === 'stop_limit' && limit_price) {
            payload.limit_price = parseFloat(limit_price);
        }

        const response = await fetch(`${API_BASE_URL}/orders`, {
            method: 'POST',
            headers: {
                ...getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (response.ok) {
            return { success: true, orderId: data.order_id };
        } else {
            return { success: false, error: data.detail || data.message || 'Failed to place order' };
        }
    } catch (err) {
        console.error('PlaceOrder API Error:', err);
        return { success: false, error: 'Network failure' };
    }
};

export const cancelOrder = async (orderId) => {
    try {
        const response = await fetch(`${API_BASE_URL}/orders/${orderId}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        const data = await response.json();
        if (response.ok) {
            return { success: true };
        } else {
            return { success: false, error: data.message || 'Failed to cancel order' };
        }
    } catch (err) {
        console.error('CancelOrder API Error:', err);
        return { success: false, error: 'Network failure' };
    }
};

export const fetchOrders = async (params = {}) => {
    try {
        const qs = new URLSearchParams(params).toString();
        const urlStr = qs ? `${API_BASE_URL}/orders?${qs}` : `${API_BASE_URL}/orders`;

        const response = await fetch(urlStr, {
            method: 'GET',
            headers: getAuthHeader()
        });
        const data = await response.json();
        if (response.ok) {
            return { success: true, orders: data };
        } else {
            return { success: false, error: 'Failed to fetch orders' };
        }
    } catch (err) {
        console.error('FetchOrders API Error:', err);
        return { success: false, error: 'Network failure' };
    }
};

export const fetchTrades = async ({ symbol, limit } = {}) => {
    try {
        const params = new URLSearchParams();
        if (symbol) params.set('symbol', symbol);
        if (limit)  params.set('limit', limit);
        const qs = params.toString();
        const url = qs ? `${API_BASE_URL}/my/trades?${qs}` : `${API_BASE_URL}/my/trades`;

        const response = await fetch(url, {
            method: 'GET',
            headers: getAuthHeader()
        });
        const data = await response.json();
        if (response.ok) {
            return { success: true, trades: Array.isArray(data) ? data : [] };
        } else {
            return { success: false, error: 'Failed to fetch trades' };
        }
    } catch (err) {
        console.error('FetchTrades API Error:', err);
        return { success: false, error: 'Network failure' };
    }
};
