// tests/matcher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findMatchingTradeId } from '../src/matcher.js';
import { TradeRequestCache } from '../src/cache.js';

function makeCache(): TradeRequestCache {
  const c = new TradeRequestCache(':memory:');
  vi.spyOn(c, 'persist').mockImplementation(() => {});
  return c;
}

describe('findMatchingTradeId', () => {
  let cache: TradeRequestCache;

  beforeEach(() => {
    cache = makeCache();
  });

  it('returns null when cache is empty', () => {
    expect(findMatchingTradeId(cache, '76561198012345678', '')).toBeNull();
  });

  it('matches by SteamID64 (primary)', () => {
    cache.upsert('tx-abc', '76561198012345678');
    const result = findMatchingTradeId(cache, '76561198012345678', 'some note');
    expect(result).toBe('tx-abc');
  });

  it('SteamID64 match takes priority over note match', () => {
    cache.upsert('tx-id-match', '76561198012345678');
    cache.set('tx-note-match', { steamId64: null, createdAt: Date.now() });
    // Note contains 'tx-note-match' but SteamID64 matches 'tx-id-match'
    const result = findMatchingTradeId(cache, '76561198012345678', 'tx-note-match');
    expect(result).toBe('tx-id-match');
  });

  it('falls back to exact note match when no SteamID64 match', () => {
    cache.set('tx-exact', { steamId64: null, createdAt: Date.now() });
    const result = findMatchingTradeId(cache, '76561198000000000', 'tx-exact');
    expect(result).toBe('tx-exact');
  });

  it('exact note match is refused when SteamID64 belongs to another pending trade', () => {
    cache.set('tx-exact', { steamId64: '76561198099999999', createdAt: Date.now() });
    const result = findMatchingTradeId(cache, '76561198000000000', 'tx-exact');
    expect(result).toBeNull();
  });

  it('falls back to substring note match', () => {
    cache.set('abc123', { steamId64: null, createdAt: Date.now() });
    const result = findMatchingTradeId(cache, '76561198000000000', 'payment ref abc123 thanks');
    expect(result).toBe('abc123');
  });

  it('substring match is refused when SteamID64 belongs to a different sender', () => {
    cache.set('abc123', { steamId64: '76561198099999999', createdAt: Date.now() });
    const result = findMatchingTradeId(cache, '76561198000000000', 'abc123');
    expect(result).toBeNull();
  });

  it('returns null when note does not match any key', () => {
    cache.set('abc123', { steamId64: null, createdAt: Date.now() });
    const result = findMatchingTradeId(cache, '76561198000000000', 'completely different');
    expect(result).toBeNull();
  });
});
