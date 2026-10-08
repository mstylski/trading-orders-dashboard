export type QuoteSocket = Pick<
  WebSocket,
  'readyState' | 'onopen' | 'onclose' | 'onerror' | 'onmessage' | 'send' | 'close'
>;

export const QUOTES_URL = 'wss://webquotes.geeksoft.pl/websocket/quotes';
