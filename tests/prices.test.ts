// tests/prices.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCSPrice,
  getRustPrice,
  getItemPrice,
  _setCsPriceCache,
  _setRustPriceCache,
} from '../src/prices.js';

beforeEach(() => {
  _setCsPriceCache({});
  _setRustPriceCache({});
});

describe('getCSPrice', () => {
  it('returns 0 when cache is empty', () => {
    expect(getCSPrice('AK-47 | Redline (Field-Tested)')).toBe(0);
  });

  it('returns last_24h when available', () => {
    _setCsPriceCache({ 'AK-47 | Redline (Field-Tested)': { last_24h: 15.5, last_7d: 14, last_30d: 13, last_90d: 12 } });
    expect(getCSPrice('AK-47 | Redline (Field-Tested)')).toBe(15.5);
  });

  it('falls back to last_7d when last_24h is null', () => {
    _setCsPriceCache({ 'AWP | Dragon Lore': { last_24h: null, last_7d: 1500, last_30d: 1400, last_90d: 1300 } });
    expect(getCSPrice('AWP | Dragon Lore')).toBe(1500);
  });

  it('falls back to last_30d when earlier windows are null', () => {
    _setCsPriceCache({ 'Knife': { last_24h: null, last_7d: null, last_30d: 200, last_90d: 180 } });
    expect(getCSPrice('Knife')).toBe(200);
  });

  it('falls back to last_90d as final resort', () => {
    _setCsPriceCache({ 'Knife': { last_24h: null, last_7d: null, last_30d: null, last_90d: 180 } });
    expect(getCSPrice('Knife')).toBe(180);
  });

  it('returns 0 when all windows are null', () => {
    _setCsPriceCache({ 'Knife': { last_24h: null, last_7d: null, last_30d: null, last_90d: null } });
    expect(getCSPrice('Knife')).toBe(0);
  });

  it('returns 0 for unknown item', () => {
    _setCsPriceCache({ 'AK-47 | Redline (Field-Tested)': { last_24h: 15, last_7d: null, last_30d: null, last_90d: null } });
    expect(getCSPrice('Unknown Skin')).toBe(0);
  });
});

describe('getRustPrice', () => {
  it('returns 0 when cache is empty', () => {
    expect(getRustPrice('Assault Rifle')).toBe(0);
  });

  it('returns suggested_price when available', () => {
    _setRustPriceCache({ 'Assault Rifle': { market_hash_name: 'Assault Rifle', suggested_price: 5.5, min_price: 4, median_price: 5, mean_price: 5.1 } });
    expect(getRustPrice('Assault Rifle')).toBe(5.5);
  });

  it('falls back to min_price when suggested_price is null', () => {
    _setRustPriceCache({ 'Assault Rifle': { market_hash_name: 'Assault Rifle', suggested_price: null, min_price: 4, median_price: 5, mean_price: 5.1 } });
    expect(getRustPrice('Assault Rifle')).toBe(4);
  });

  it('falls back to median_price', () => {
    _setRustPriceCache({ 'Assault Rifle': { market_hash_name: 'Assault Rifle', suggested_price: null, min_price: null, median_price: 5, mean_price: 5.1 } });
    expect(getRustPrice('Assault Rifle')).toBe(5);
  });

  it('falls back to mean_price', () => {
    _setRustPriceCache({ 'Assault Rifle': { market_hash_name: 'Assault Rifle', suggested_price: null, min_price: null, median_price: null, mean_price: 5.1 } });
    expect(getRustPrice('Assault Rifle')).toBe(5.1);
  });
});

describe('getItemPrice', () => {
  it('routes AppID 730 to CS cache', () => {
    _setCsPriceCache({ 'AK-47': { last_24h: 10, last_7d: null, last_30d: null, last_90d: null } });
    expect(getItemPrice('AK-47', 730)).toBe(10);
  });

  it('routes AppID 252490 to Rust cache', () => {
    _setRustPriceCache({ 'AK-47': { market_hash_name: 'AK-47', suggested_price: 3, min_price: null, median_price: null, mean_price: null } });
    expect(getItemPrice('AK-47', 252490)).toBe(3);
  });

  it('accepts an item object and uses appid field', () => {
    _setCsPriceCache({ 'M4A4': { last_24h: 20, last_7d: null, last_30d: null, last_90d: null } });
    expect(getItemPrice({ market_hash_name: 'M4A4', appid: 730 })).toBe(20);
  });

  it('returns 0 for empty market_hash_name', () => {
    expect(getItemPrice({ market_hash_name: '' })).toBe(0);
  });

  it('without appid: prefers Rust when item exists in both caches', () => {
    _setCsPriceCache({ 'Knife': { last_24h: 50, last_7d: null, last_30d: null, last_90d: null } });
    _setRustPriceCache({ 'Knife': { market_hash_name: 'Knife', suggested_price: 2, min_price: null, median_price: null, mean_price: null } });
    expect(getItemPrice('Knife')).toBe(2); // Rust wins since it's checked first
  });

  it('falls through to CS when Rust returns 0', () => {
    _setCsPriceCache({ 'AK-47': { last_24h: 10, last_7d: null, last_30d: null, last_90d: null } });
    expect(getItemPrice('AK-47')).toBe(10);
  });
});
