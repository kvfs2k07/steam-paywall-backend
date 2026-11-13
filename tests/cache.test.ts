// tests/cache.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TradeRequestCache } from '../src/cache.js';

// Use in-memory cache with no file I/O for unit tests
const NO_FILE = ':memory:';

function makeCache(): TradeRequestCache {
  const c = new TradeRequestCache(NO_FILE);
  // Stub out persist so it doesn't touch the FS
  vi.spyOn(c, 'persist').mockImplementation(() => {});
  return c;
}

describe('TradeRequestCache', () => {
  let cache: TradeRequestCache;

  beforeEach(() => {
    cache = makeCache();
  });

  it('starts empty', () => {
    expect(cache.size).toBe(0);
  });

  it('upsert adds an entry', () => {
    cache.upsert('tx-1', '76561198012345678');
    expect(cache.size).toBe(1);
    expect(cache.get('tx-1')?.steamId64).toBe('76561198012345678');
  });

  it('upsert replaces previous entry for same SteamID64', () => {
    cache.upsert('tx-1', '76561198012345678');
    cache.upsert('tx-2', '76561198012345678');
    expect(cache.size).toBe(1);
    expect(cache.has('tx-1')).toBe(false);
    expect(cache.has('tx-2')).toBe(true);
  });

  it('allows multiple entries with different SteamID64s', () => {
    cache.upsert('tx-1', '76561198012345678');
    cache.upsert('tx-2', '76561198087654321');
    expect(cache.size).toBe(2);
  });

  it('delete removes an entry', () => {
    cache.upsert('tx-1', null);
    cache.delete('tx-1');
    expect(cache.size).toBe(0);
  });

  it('evictExpired removes stale entries', () => {
    const past = Date.now() - 25 * 60 * 60 * 1000; // 25h ago
    cache.set('old', { steamId64: null, createdAt: past });
    cache.set('new', { steamId64: null, createdAt: Date.now() });
    const evicted = cache.evictExpired();
    expect(evicted).toBe(true);
    expect(cache.has('old')).toBe(false);
    expect(cache.has('new')).toBe(true);
  });

  it('evictExpired returns false when nothing expired', () => {
    cache.upsert('tx-1', null);
    expect(cache.evictExpired()).toBe(false);
  });
});
