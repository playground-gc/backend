/**
 * @file wsEvents.js
 * @description Enumeration of all WebSocket event-type strings sent by the trading backend.
 * Centralising these prevents typo-driven bugs when subscribing to or routing WS messages.
 * @exports WS_EVENTS  Plain object of event name constants.
 * @note Keep in sync with the backend's message schema documentation.
 */

export const WS_EVENTS = {
  // From GBM market generator  (ws://host:8001/ws/market/{symbol})
  MARKET_DATA:    'market_data',

  // From matching engine  (ws://host:8001/ws/{symbol})
  ORDERBOOK:      'orderbook',
  TRADE:          'trade',

  // From candle service  (ws://host:8001/ws/{symbol})
  CANDLE:         'candle',

  // From trigger engine  (ws://host:8001/ws/orders/{user_id})
  STOP_TRIGGERED: 'stop_triggered',

  // Server keepalive
  PING:           'ping',
};

export const WS_INTERVALS = {
  ONE_SECOND:  '1s',
  TEN_SECONDS: '10s',
  ONE_MINUTE:  '1m',
};
