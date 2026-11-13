// src/tracking.ts
// Apache-2.0 License — see LICENSE

import fs from 'fs';
import logger from './logger.js';
import type { TrackedTrade } from './types.js';

const TRACKED_TRADES_FILE = 'tracked_trades.json';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class TradeTracker {
  private readonly store = new Map<string, TrackedTrade>();
  private readonly file: string;
  private readonly windowMs: number;

  constructor(file = TRACKED_TRADES_FILE, windowMs = SEVEN_DAYS_MS) {
    this.file = file;
    this.windowMs = windowMs;
  }

  get(id: string): TrackedTrade | undefined {
    return this.store.get(id);
  }

  set(id: string, trade: TrackedTrade): void {
    this.store.set(id, trade);
  }

  delete(id: string): void {
    this.store.delete(id);
  }

  get size(): number {
    return this.store.size;
  }

  entries(): IterableIterator<[string, TrackedTrade]> {
    return this.store.entries();
  }

  values(): IterableIterator<TrackedTrade> {
    return this.store.values();
  }

  persist(): void {
    try {
      fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.store), null, 2));
    } catch (err) {
      logger.error(`Failed to save tracked trades: ${(err as Error).message}`);
    }
  }

  load(): void {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = fs.readFileSync(this.file, 'utf8');
      const data = JSON.parse(raw) as Record<string, TrackedTrade>;
      const now = Date.now();
      let hasExpired = false;

      for (const [key, value] of Object.entries(data)) {
        if (now - value.acceptedAt > this.windowMs) {
          hasExpired = true;
        } else {
          this.store.set(key, value);
        }
      }

      if (hasExpired) this.persist();
      logger.info(`Loaded ${this.store.size} trade(s) into 7-day Trade Protection tracking.`);
    } catch (err) {
      logger.error(`Failed to load tracked trades: ${(err as Error).message}`);
    }
  }

  /** Prune trades older than the monitoring window. Returns true if any were removed. */
  pruneExpired(): boolean {
    const now = Date.now();
    let pruned = false;
    for (const [id, trade] of this.store.entries()) {
      if (now - trade.acceptedAt > this.windowMs) {
        logger.info(`Transaction ${id} passed the 7-day Trade Protection window safely. Monitoring ended.`);
        this.store.delete(id);
        pruned = true;
      }
    }
    return pruned;
  }
}
