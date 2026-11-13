// src/cache.ts
// Apache-2.0 License — see LICENSE

import fs from 'fs';
import logger from './logger.js';
import type { TradeRequest } from './types.js';

const CACHE_FILE = 'trade_cache.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class TradeRequestCache {
  private readonly store = new Map<string, TradeRequest>();
  private readonly file: string;
  private readonly ttl: number;

  constructor(file = CACHE_FILE, ttl = CACHE_TTL_MS) {
    this.file = file;
    this.ttl = ttl;
  }

  get(id: string): TradeRequest | undefined {
    return this.store.get(id);
  }

  set(id: string, entry: TradeRequest): void {
    this.store.set(id, entry);
  }

  delete(id: string): void {
    this.store.delete(id);
  }

  has(id: string): boolean {
    return this.store.has(id);
  }

  get size(): number {
    return this.store.size;
  }

  entries(): IterableIterator<[string, TradeRequest]> {
    return this.store.entries();
  }

  /** Remove a previous pending trade for the same SteamID64 and add the new one. */
  upsert(id: string, steamId64: string | null): void {
    if (steamId64) {
      for (const [oldId, oldData] of this.store.entries()) {
        if (oldData.steamId64 === steamId64) {
          logger.info(`Superseding previous trade request ${oldId} for SteamID64 ${steamId64} with new request ${id}`);
          this.store.delete(oldId);
        }
      }
    }
    this.store.set(id, { steamId64, createdAt: Date.now() });
  }

  evictExpired(): boolean {
    const now = Date.now();
    let evicted = false;
    for (const [key, value] of this.store.entries()) {
      if (now - value.createdAt > this.ttl) {
        this.store.delete(key);
        evicted = true;
      }
    }
    return evicted;
  }

  persist(): void {
    try {
      fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.store)));
    } catch (err) {
      logger.error(`Failed to save trade request cache: ${(err as Error).message}`);
    }
  }

  load(): void {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = fs.readFileSync(this.file, 'utf8');
      const data = JSON.parse(raw) as Record<string, TradeRequest>;
      const now = Date.now();
      let hasExpired = false;

      for (const [key, value] of Object.entries(data)) {
        if (now - value.createdAt > this.ttl) {
          hasExpired = true;
        } else {
          this.store.set(key, value);
        }
      }

      if (hasExpired) this.persist();
      logger.info(`Loaded ${this.store.size} trade request(s) from cache.`);
    } catch (err) {
      logger.error(`Failed to load trade request cache: ${(err as Error).message}`);
    }
  }
}
