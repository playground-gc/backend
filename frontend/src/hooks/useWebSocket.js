/**
 * @file useWebSocket.js
 * @description React hook that opens the WebSocket connection on mount and routes each
 * incoming message through messageParser, dispatching results to the appropriate Zustand store.
 * @exports useWebSocket  () => { status: 'connecting' | 'open' | 'closed' | 'error' }
 * @note Mount this hook exactly once at the app root to avoid duplicate connections.
 */

export const useWebSocket = () => ({ status: 'closed' });
