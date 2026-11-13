// src/types.ts
// Apache-2.0 License — see LICENSE

export interface Config {
  steamRefreshToken: string;
  steamApiKey: string | null;
  webhookUrl: string;
  port: number;
  sharedSecret: string;
  minItemPrice: number;
}

export interface TradeRequest {
  steamId64: string | null;
  createdAt: number;
}

export interface TrackedItem {
  assetid: string;
  appid: number;
  contextid: string;
  market_hash_name: string;
}

export interface TrackedTrade {
  transactionId: string;
  offerId: string;
  tradeId: string | null;
  partnerSteamId64: string | null;
  acceptedAt: number;
  amount: number;
  items: TrackedItem[];
}

export interface CsPriceEntry {
  last_24h: number | null;
  last_7d: number | null;
  last_30d: number | null;
  last_90d: number | null;
}

export interface SkinportItem {
  market_hash_name: string;
  suggested_price: number | null;
  min_price: number | null;
  median_price: number | null;
  mean_price: number | null;
}

export type CsPriceCache = Record<string, CsPriceEntry>;
export type RustPriceCache = Record<string, SkinportItem>;

export interface WebhookRequest {
  transactionId: string;
  amount: number;
  status?: string;
  event?: string;
  tradeId?: string | null;
  offerId?: string | null;
  partnerSteamId64?: string | null;
  reason?: string;
}

export interface WebhookResponse {
  accept?: boolean;
  reason?: string;
}
