// src/prices.ts
// Apache-2.0 License — see LICENSE

import fetch from 'node-fetch';
import logger from './logger.js';
import type { CsPriceCache, RustPriceCache, CsPriceEntry, SkinportItem } from './types.js';

let csPriceCache: CsPriceCache = {};
let rustPriceCache: RustPriceCache = {};

export async function loadCSPriceCache(): Promise<void> {
  try {
    const res = await fetch('https://prices.csgotrader.app/latest/steam.json');
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    csPriceCache = (await res.json()) as CsPriceCache;
    logger.info(`CS price cache refreshed (${Object.keys(csPriceCache).length} items)`);
  } catch (err) {
    logger.error(`Failed to load CS price cache: ${(err as Error).message}`);
  }
}

export async function loadRustPriceCache(): Promise<void> {
  try {
    const res = await fetch('https://api.skinport.com/v1/items?app_id=252490&currency=USD', {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'br',
        'User-Agent': 'SteamPaywallBackend/1.0',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const data = await res.json();
    if (!Array.isArray(data)) {
      logger.warn('Unexpected Rust price response format from Skinport');
      return;
    }

    const cache: RustPriceCache = {};
    for (const item of data as SkinportItem[]) {
      if (item.market_hash_name) cache[item.market_hash_name] = item;
    }
    rustPriceCache = cache;
    logger.info(`Rust price cache refreshed (${Object.keys(rustPriceCache).length} items from Skinport)`);
  } catch (err) {
    logger.error(`Failed to load Rust price cache: ${(err as Error).message}`);
  }
}

export async function loadPriceCache(): Promise<void> {
  await Promise.all([loadCSPriceCache(), loadRustPriceCache()]);
}

export function getCSPrice(marketHashName: string): number {
  const item: CsPriceEntry | undefined = csPriceCache[marketHashName];
  if (!item) return 0;

  if (item.last_24h != null && item.last_24h > 0) return item.last_24h;
  if (item.last_7d != null && item.last_7d > 0) return item.last_7d;
  if (item.last_30d != null && item.last_30d > 0) return item.last_30d;
  if (item.last_90d != null && item.last_90d > 0) return item.last_90d;
  return 0;
}

export function getRustPrice(marketHashName: string): number {
  const item: SkinportItem | undefined = rustPriceCache[marketHashName];
  if (!item) return 0;

  if (item.suggested_price != null && item.suggested_price > 0) return item.suggested_price;
  if (item.min_price != null && item.min_price > 0) return item.min_price;
  if (item.median_price != null && item.median_price > 0) return item.median_price;
  if (item.mean_price != null && item.mean_price > 0) return item.mean_price;
  return 0;
}

export interface PriceableItem {
  market_hash_name?: string;
  appid?: number | string;
}

export function getItemPrice(itemOrName: PriceableItem | string, appId?: number): number {
  let name = '';
  let app = appId;

  if (typeof itemOrName === 'object' && itemOrName !== null) {
    name = itemOrName.market_hash_name ?? '';
    if (app == null && itemOrName.appid != null) {
      app = Number(itemOrName.appid);
    }
  } else {
    name = itemOrName;
  }

  if (!name) return 0;

  if (app === 252490) return getRustPrice(name);
  if (app === 730) return getCSPrice(name);

  // No appid: check Rust first, then CS
  const rustPrice = getRustPrice(name);
  return rustPrice > 0 ? rustPrice : getCSPrice(name);
}

/** Expose raw caches for testing */
export function _setCsPriceCache(cache: CsPriceCache): void { csPriceCache = cache; }
export function _setRustPriceCache(cache: RustPriceCache): void { rustPriceCache = cache; }
