import { useState, useEffect, useCallback } from 'react';
import { fetchPortfolio, fetchOrders, fetchTrades, fetchMe } from '../services/api';
import { dataManager } from '../services/dataManager';

/**
 * @file usePortfolio.js
 * @description Hook to manage user portfolio and orders.
 */

export const usePortfolio = (isAuthenticated) => {
    const [holdings, setHoldings] = useState([]);
    const [orders, setOrders] = useState([]);
    const [trades, setTrades] = useState([]);
    const [livePrices, setLivePrices] = useState({});
    const [cashBalance, setCashBalance] = useState(0);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        if (!isAuthenticated) return;
        setLoading(true);
        const [meResult, portResult, orderResult, tradeResult] = await Promise.all([
            fetchMe(),
            fetchPortfolio(),
            fetchOrders({ status: 'open' }),
            fetchTrades()
        ]);

        if (meResult.success) setCashBalance(meResult.data.cash_balance ?? 0);
        if (portResult.success) setHoldings(portResult.holdings);
        if (orderResult.success) setOrders(orderResult.orders);
        if (tradeResult.success) setTrades(tradeResult.trades);
        setLoading(false);
    }, [isAuthenticated]);

    useEffect(() => {
        if (isAuthenticated) {
            refresh();
            const interval = setInterval(refresh, 10000); // Poll every 10s
            return () => clearInterval(interval);
        }
    }, [isAuthenticated, refresh]);

    // Subscribe to live prices for all held symbols
    useEffect(() => {
        if (!holdings.length) return;
        const unsubs = holdings.map(h => {
            return dataManager.subscribe(h.symbol, (data) => {
                setLivePrices(prev => ({ ...prev, [h.symbol]: data.ticker.price }));
            });
        });
        return () => unsubs.forEach(u => u());
    }, [holdings]);

    // Compute derived metrics
    let unrealisedPnL = 0;

    const positions = holdings.map(h => {
        const currentPrice = livePrices[h.symbol] || h.current_price || h.avg_cost;
        const marketValue = h.quantity * currentPrice;
        const costBasis = h.quantity * h.avg_cost;
        const pnl = marketValue - costBasis;
        unrealisedPnL += pnl;

        return { ...h, currentPrice, marketValue, pnl };
    });

    const portfolioValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    const totalEquity = cashBalance + portfolioValue;

    return { holdings: positions, orders, trades, unrealisedPnL, totalEquity, cashBalance, loading, refresh };
};
