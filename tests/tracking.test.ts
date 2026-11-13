// tests/tracking.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TradeTracker } from '../src/tracking.js';
import type { TrackedTrade } from '../src/types.js';

function makeTracker(): TradeTracker {
  const t = new TradeTracker(':memory:', 7 * 24 * 60 * 60 * 1000);
  vi.spyOn(t, 'persist').mockImplementation(() => {});
  return t;
}

function makeTrade(overrides?: Partial<TrackedTrade>): TrackedTrade {
  return {
    transactionId: 'tx-1',
    offerId: 'offer-1',
    tradeId: null,
    partnerSteamId64: '76561198012345678',
    acceptedAt: Date.now(),
    amount: 25.5,
    items: [{ assetid: '123456', appid: 730, contextid: '2', market_hash_name: 'AK-47 | Redline' }],
    ...overrides,
  };
}

describe('TradeTracker', () => {
  let tracker: TradeTracker;

  beforeEach(() => {
    tracker = makeTracker();
  });

  it('starts empty', () => {
    expect(tracker.size).toBe(0);
  });

  it('set and get a trade', () => {
    const trade = makeTrade();
    tracker.set('tx-1', trade);
    expect(tracker.get('tx-1')).toEqual(trade);
  });

  it('delete removes a trade', () => {
    tracker.set('tx-1', makeTrade());
    tracker.delete('tx-1');
    expect(tracker.size).toBe(0);
  });

  it('pruneExpired removes old trades', () => {
    const oldTrade = makeTrade({ acceptedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }); // 8 days old
    tracker.set('tx-old', oldTrade);
    tracker.set('tx-new', makeTrade());
    const pruned = tracker.pruneExpired();
    expect(pruned).toBe(true);
    expect(tracker.has?.('tx-old') ?? tracker.get('tx-old')).toBeUndefined();
    expect(tracker.get('tx-new')).toBeDefined();
  });

  it('pruneExpired returns false when nothing is expired', () => {
    tracker.set('tx-1', makeTrade());
    expect(tracker.pruneExpired()).toBe(false);
  });

  it('values() iterates all trades', () => {
    tracker.set('tx-1', makeTrade({ transactionId: 'tx-1' }));
    tracker.set('tx-2', makeTrade({ transactionId: 'tx-2' }));
    const ids = [...tracker.values()].map((t) => t.transactionId);
    expect(ids).toContain('tx-1');
    expect(ids).toContain('tx-2');
  });
});
