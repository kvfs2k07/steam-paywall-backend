// src/vendor.d.ts
// Ambient module declarations for untyped Steam libraries
// Apache-2.0 License — see LICENSE

declare module 'steam-user' {
  import { EventEmitter } from 'events';

  class SteamUser extends EventEmitter {
    static EPersonaState: Record<string, number>;
    static EResult: Record<string, number>;

    logOn(options: { refreshToken?: string; [key: string]: unknown }): void;
    logOff(): void;
    setPersona(state: number): void;

    on(event: 'loggedOn', listener: () => void): this;
    on(event: 'webSession', listener: (sessionID: string, cookies: string[]) => void): this;
    on(event: 'disconnected', listener: (eresult: number, msg: string) => void): this;
    on(event: 'error', listener: (err: Error & { eresult?: number }) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export = SteamUser;
}

declare module 'steam-tradeoffer-manager' {
  import { EventEmitter } from 'events';

  interface TradeOfferManagerOptions {
    steam?: unknown;
    domain?: string;
    language?: string;
    pollInterval?: number;
    cancelTime?: number;
    [key: string]: unknown;
  }

  interface TradeOffer {
    id: string;
    tradeID: string | null;
    isOurOffer: boolean;
    partner: { toString(): string };
    message: string;
    itemsToGive: TradeItem[];
    itemsToReceive: TradeItem[];
    accept(cb: (err: Error | null, status: string) => void): void;
    cancel(cb: (err: Error | null) => void): void;
    getReceivedItems(getDescriptions: boolean, cb: (err: Error | null, items: TradeItem[]) => void): void;
  }

  interface TradeItem {
    assetid: string;
    appid: number | string;
    contextid: string;
    market_hash_name: string;
    name: string;
    [key: string]: unknown;
  }

  class TradeOfferManager extends EventEmitter {
    apiKey: string | null;
    accessToken: string | null;
    _community: unknown;

    constructor(options: TradeOfferManagerOptions);

    setCookies(cookies: string[], cb: (err: Error | null) => void): void;
    getInventoryContents(
      appid: number,
      contextid: number,
      tradableOnly: boolean,
      cb: (err: Error | null, inventory: TradeItem[]) => void,
    ): void;
    _apiCall(
      method: string,
      iface: { iface: string; method: string },
      version: number,
      params: Record<string, unknown>,
      cb: (err: Error | null, body: unknown) => void,
    ): void;

    on(event: 'newOffer', listener: (offer: TradeOffer) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export = TradeOfferManager;
}
