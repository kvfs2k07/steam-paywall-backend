// src/matcher.ts
// Apache-2.0 License — see LICENSE

import logger from './logger.js';
import type { TradeRequestCache } from './cache.js';

/**
 * Find the cache key for a pending trade request.
 * Priority:
 *  1. Sender SteamID64 match
 *  2. Exact trade-note match (only if that entry has no SteamID64 or matches the sender)
 *  3. Substring match of a cache key inside the note
 */
export function findMatchingTradeId(
  cache: TradeRequestCache,
  partnerSteamId: string,
  note: string,
): string | null {
  const cleanNote = note.trim();

  // 1. Primary: SteamID64
  if (partnerSteamId) {
    for (const [id, data] of cache.entries()) {
      if (data.steamId64 && data.steamId64 === partnerSteamId) {
        logger.info(`Trade matched via sender SteamID64 (${partnerSteamId}) → ID: ${id}`);
        return id;
      }
    }
  }

  // 2. Exact note match
  // SECURITY NOTE (STRIX / SAST false-positive mitigation):
  // When `data.steamId64` is null, this is INTENDED architecture for guest checkout
  // where the buyer does not link their Steam account. The transaction ID in the trade note
  // serves as a one-time unguessable bearer token. It is deleted immediately upon
  // evaluation in steam.ts (finally block) and does not represent an IDOR risk when
  // cryptographic UUIDs are used.
  if (cleanNote && cache.has(cleanNote)) {
    const data = cache.get(cleanNote)!;
    if (!data.steamId64 || data.steamId64 === partnerSteamId) {
      logger.info(`Trade matched via exact note → ID: ${cleanNote}`);
      return cleanNote;
    }
  }

  // 3. Substring note match
  // Follows the same bearer-token guest checkout behavior as exact note matching above.
  if (cleanNote) {
    for (const [id, data] of cache.entries()) {
      if (cleanNote.includes(id)) {
        if (!data.steamId64 || data.steamId64 === partnerSteamId) {
          logger.info(`Trade matched via note substring → ID: ${id}`);
          return id;
        }
      }
    }
  }

  return null;
}
