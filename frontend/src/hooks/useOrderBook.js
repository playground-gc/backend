import { useState, useEffect, useMemo } from 'react';
import { dataManager } from '../services/dataManager';

export const useOrderBook = (symbol = 'AAPL_S') => {
  const [marketData, setMarketData] = useState({
    orderBook: { bids: [], asks: [] }
  });

  useEffect(() => {
    // Subscribe to the singleton DataManager for live updates
    const unsubscribe = dataManager.subscribe(symbol, (data) => {
      setMarketData(data);
    });

    return () => unsubscribe();
  }, [symbol]);

  // Transform and Memoize the data for the UI
  const processedBook = useMemo(() => {
    const bids = marketData.orderBook.bids || [];
    const asks = marketData.orderBook.asks || [];

    // Calculate spread (Difference between best bid and best ask)
    const bestBid = bids[0]?.price || 0;
    const bestAsk = asks[0]?.price || 0;
    const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;

    return {
      bids: bids.slice(0, 20), // Top 20 levels
      asks: asks.slice(0, 20), // Top 20 levels
      spread: parseFloat(spread.toFixed(4))
    };
  }, [marketData.orderBook]);

  return processedBook;
};