import { InjectionToken } from '@angular/core';

export type QuoteSocket = Pick<
  WebSocket,
  'readyState' | 'onopen' | 'onclose' | 'onerror' | 'onmessage' | 'send' | 'close'
>;

export const QUOTES_URL = 'wss://webquotes.geeksoft.pl/websocket/quotes';

export const QUOTE_SOCKET_FACTORY = new InjectionToken<(url: string) => QuoteSocket>(
  'QUOTE_SOCKET_FACTORY',
  { providedIn: 'root', factory: () => (url) => new WebSocket(url) },
);
