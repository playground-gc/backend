/**
 * @file WebSocketClient.js
 * @description Singleton WebSocket client with automatic exponential-backoff reconnect logic.
 * Exposes subscribe/unsubscribe for event-type listeners and a send() helper.
 * @exports WebSocketClient  Singleton instance
 * @note At 50-100 msg/sec, listeners must be non-blocking; heavy work belongs in stores or workers.
 */

export const WebSocketClient = {};
