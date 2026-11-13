// src/steam.ts
// Apache-2.0 License — see LICENSE

import SteamUser from 'steam-user';
import TradeOfferManager from 'steam-tradeoffer-manager';
import fetch from 'node-fetch';
import logger from './logger.js';
import { getItemPrice } from './prices.js';
import { findMatchingTradeId } from './matcher.js';
import { notifyWebhookTradeReceived, notifyWebhookReversal } from './webhook.js';
import type { Config, TrackedItem, TrackedTrade } from './types.js';
import type { TradeRequestCache } from './cache.js';
import type { TradeTracker } from './tracking.js';

// Steam EEconTradeStatus codes that indicate a rollback/reversal
const ROLLBACK_STATUSES = new Set([5, 6, 7, 8, 9, 11, 12]);

export function createSteamBot(
  config: Config,
  cache: TradeRequestCache,
  tracker: TradeTracker,
): void {
  let currentAccessToken: string | null = null;

  const steamClient = new SteamUser();
  const manager = new TradeOfferManager({
    steam: steamClient,
    domain: 'localhost',
    language: 'en',
    pollInterval: 5000,
    cancelTime: 0,
  });

  // ── Login ──────────────────────────────────────────────────────────────────

  steamClient.logOn({ refreshToken: config.steamRefreshToken });

  steamClient.on('loggedOn', () => {
    logger.info('Steam client logged in');
    steamClient.setPersona(SteamUser.EPersonaState['Online'] as number);
  });

  steamClient.on('webSession', (_sessionID: string, cookies: string[]) => {
    // Extract access token from steamLoginSecure cookie
    try {
      const loginCookie = (cookies ?? []).find((c) => c?.startsWith('steamLoginSecure='));
      if (loginCookie) {
        const val = decodeURIComponent(loginCookie.substring('steamLoginSecure='.length));
        const parts = val.split('||');
        if (parts.length > 1 && parts[1]) currentAccessToken = parts[1] ?? null;
      }
    } catch {
      // non-fatal
    }

    manager.setCookies(cookies, (err: Error | null) => {
      if (err) {
        logger.error(`Error setting cookies on TradeOfferManager: ${err.message}`);
        return;
      }
      if (!manager.accessToken && currentAccessToken) {
        manager.accessToken = currentAccessToken;
      }
      const hasKey = Boolean(config.steamApiKey ?? manager.apiKey);
      const hasToken = Boolean(manager.accessToken ?? currentAccessToken);
      logger.info(
        `Steam Trade Manager ready (API Key: ${hasKey ? 'Available' : 'Not Found'} | Access Token: ${hasToken ? 'Available' : 'Not Found'})`,
      );
    });
  });

  steamClient.on('disconnected', (_eresult: number, msg: string) => {
    logger.warn(`Steam client disconnected: ${msg ?? 'No message'}`);
  });

  steamClient.on('error', (err: Error & { eresult?: number }) => {
    logger.error(`Steam client error: ${err.message} (EResult: ${err.eresult ?? 'unknown'})`);

    if (err.eresult === SteamUser.EResult.LogonSessionReplaced) {
      logger.warn('Another session logged into this account. Reconnecting in 30s…');
      setTimeout(() => {
        try {
          steamClient.logOn({ refreshToken: config.steamRefreshToken });
        } catch (reconnectErr) {
          logger.error(`Failed to relog: ${(reconnectErr as Error).message}`);
        }
      }, 30_000);
    }

    if (err.eresult === SteamUser.EResult.AccessDenied) {
      logger.error('STEAM_REFRESH_TOKEN has been revoked or expired. Generate a new one and update .env.');
    }
  });

  manager.on('error', (err: Error) => {
    logger.error(`TradeOfferManager error: ${err.message}`);
  });

  // ── Trade handler ──────────────────────────────────────────────────────────

  manager.on('newOffer', async (offer: any) => {
    if (offer.isOurOffer) return;

    const partner: string = offer.partner.toString();
    const note: string = offer.message?.trim() ?? '';

    if (offer.itemsToGive.length > 0) {
      logger.warn(`Ignoring trade from ${partner}: they requested items from our inventory.`);
      return;
    }

    if (offer.itemsToReceive.length === 0) {
      logger.warn(`Ignoring trade from ${partner}: offer contains no items.`);
      return;
    }

    const tradeId = findMatchingTradeId(cache, partner, note);
    if (!tradeId) {
      logger.warn(`Ignoring trade from ${partner}: no matching request found (note: "${note}").`);
      return;
    }

    const requestData = cache.get(tradeId);
    if (!requestData) {
      logger.warn(`Ignoring trade from ${partner}: ID "${tradeId}" not in cache.`);
      return;
    }

    // Value items above minimum threshold
    let totalValue = 0;
    let skipped = 0;
    for (const item of offer.itemsToReceive as any[]) {
      if (item.market_hash_name) {
        const price = getItemPrice(item);
        if (price >= config.minItemPrice) {
          totalValue += price;
        } else {
          skipped++;
          logger.warn(
            `Item "${item.market_hash_name}" (AppID ${item.appid}) below minimum $${config.minItemPrice.toFixed(2)} — excluded`,
          );
        }
      }
    }

    if (skipped > 0) {
      logger.info(`${skipped} item(s) below minimum excluded from trade ${tradeId}.`);
    }

    logger.info(`Trade offer for ID ${tradeId} received — total valid value $${totalValue.toFixed(2)}`);

    try {
      const webhookResp = await notifyWebhookTradeReceived(config, tradeId, totalValue);

      if (webhookResp.accept === true) {
        try {
          const status = await acceptOfferAsync(offer);
          logger.info(`Trade ${tradeId} accepted on Steam (status: ${status}).`);
          await registerAcceptedTradeForTracking(offer, tradeId, totalValue, tracker);
        } catch (acceptErr) {
          logger.error(`Error accepting trade ${tradeId}: ${(acceptErr as Error).message}`);
        }
      } else {
        await silentCancel(offer);
        logger.warn(`Trade ${tradeId} rejected by webhook (Reason: ${webhookResp.reason ?? 'none'}). Cancelled.`);
      }
    } catch (err) {
      logger.error(`Error processing webhook for trade ${tradeId}: ${(err as Error).message}`);
      await silentCancel(offer);
    } finally {
      cache.delete(tradeId);
      cache.persist();
    }
  });

  // ── Rollback detection ─────────────────────────────────────────────────────

  async function checkTrackedTrades(): Promise<void> {
    if (tracker.size === 0) return;

    const pruned = tracker.pruneExpired();
    if (pruned) tracker.persist();
    if (tracker.size === 0) return;

    // Collect distinct AppIDs
    const appIds = new Set<number>();
    for (const trade of tracker.values()) {
      for (const item of trade.items) appIds.add(item.appid);
    }

    // Fetch current bot inventory per AppID
    const currentAssetIds = new Set<string>();
    for (const appid of appIds) {
      try {
        const inventory = await getBotInventory(appid);
        for (const item of inventory as any[]) currentAssetIds.add(String(item.assetid));
      } catch (err) {
        logger.warn(`Failed to fetch inventory for AppID ${appid}: ${(err as Error).message}. Skipping cycle.`);
        return;
      }
    }

    // Check each tracked trade for missing items
    for (const [id, trade] of tracker.entries()) {
      const missing = trade.items.find((it) => !currentAssetIds.has(it.assetid));
      if (!missing) continue;

      logger.warn(
        `Item "${missing.market_hash_name}" (${missing.assetid}) for transaction ${id} is MISSING — checking rollback…`,
      );

      const isRolledBack = await checkSteamTradeRollback(trade, manager, currentAccessToken, config);
      if (isRolledBack) {
        logger.error(`Trade rollback CONFIRMED for transaction ${id}! Alerting webhook…`);
        await notifyWebhookReversal(config, trade);
        tracker.delete(id);
        tracker.persist();
      } else {
        logger.info(`No rollback detected for ${id}. Item may be temporarily out of sync.`);
      }
    }
  }

  function getBotInventory(appid: number, contextid = 2): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      manager.getInventoryContents(appid, contextid, false, (err: Error | null, inv: unknown[]) => {
        if (err) return reject(err);
        resolve(inv ?? []);
      });
    });
  }

  // ── Process-level error guards ─────────────────────────────────────────────

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Rejection: ${reason}`);
  });

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught Exception: ${err.stack ?? err.message}`);
  });

  // ── Periodic tasks ─────────────────────────────────────────────────────────

  setInterval(() => {
    const evicted = cache.evictExpired();
    if (evicted) cache.persist();
  }, 60 * 60 * 1000);

  // Initial rollback check 30s after boot, then every 15 minutes
  setTimeout(() => void checkTrackedTrades(), 30_000);
  setInterval(() => void checkTrackedTrades(), 15 * 60 * 1000);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function acceptOfferAsync(offer: any): Promise<string> {
  return new Promise((resolve, reject) => {
    offer.accept((err: Error | null, status: string) => {
      if (err) return reject(err);
      resolve(status);
    });
  });
}

async function silentCancel(offer: any): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      offer.cancel((err: Error | null) => (err ? reject(err) : resolve()));
    });
  } catch {
    // Ignore cancel errors
  }
}

async function registerAcceptedTradeForTracking(
  offer: any,
  transactionId: string,
  amount: number,
  tracker: TradeTracker,
): Promise<void> {
  try {
    let receivedItems: any[] = [];

    // Retry up to 3 times — Steam receipt can take a moment
    for (let attempt = 1; attempt <= 3; attempt++) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      try {
        receivedItems = await new Promise<any[]>((resolve, reject) => {
          offer.getReceivedItems(false, (err: Error | null, items: any[]) => {
            if (err) return reject(err);
            resolve(items ?? []);
          });
        });
        if (receivedItems.length > 0) break;
      } catch (err) {
        if (attempt === 3) {
          logger.warn(`Could not get new asset IDs for offer ${offer.id}: ${(err as Error).message}`);
        }
      }
    }

    const source = receivedItems.length > 0 ? receivedItems : offer.itemsToReceive;
    const items: TrackedItem[] = source.map((item: any) => ({
      assetid: String(item.assetid),
      appid: Number(item.appid),
      contextid: String(item.contextid ?? '2'),
      market_hash_name: String(item.market_hash_name ?? item.name ?? ''),
    }));

    const trade: TrackedTrade = {
      transactionId,
      offerId: String(offer.id),
      tradeId: offer.tradeID ? String(offer.tradeID) : null,
      partnerSteamId64: offer.partner?.toString() ?? null,
      acceptedAt: Date.now(),
      amount: typeof amount === 'number' ? amount : 0,
      items,
    };

    tracker.set(transactionId, trade);
    tracker.persist();

    logger.info(
      `Started 7-day Trade Protection tracking for transaction ${transactionId} (${items.length} item(s), $${amount})`,
    );
  } catch (err) {
    logger.error(`Error registering trade for 7-day tracking: ${(err as Error).message}`);
  }
}

async function checkSteamTradeRollback(
  trackedTrade: TrackedTrade,
  manager: any,
  currentAccessToken: string | null,
  config: Config,
): Promise<boolean> {
  const apiKey = config.steamApiKey ?? manager.apiKey;
  const accessToken = manager.accessToken ?? currentAccessToken;

  logger.info(
    `Checking rollback for transaction ${trackedTrade.transactionId} (tradeId: ${trackedTrade.tradeId ?? 'none'})`,
  );

  // Method 1A: manager._apiCall (uses session cookies)
  let apiTrades: any[] | null = null;

  if (apiKey ?? accessToken) {
    try {
      const apiRes = await new Promise<any>((resolve, reject) => {
        manager._apiCall(
          'GET',
          { iface: 'IEconService', method: 'GetTradeHistory' },
          1,
          { max_trades: 100, include_failed: 1, include_total: 1 },
          (err: Error | null, body: any) => (err ? reject(err) : resolve(body)),
        );
      });
      apiTrades =
        apiRes?.response?.trades ?? apiRes?.trades ?? null;
      if (apiTrades) logger.info(`Fetched ${apiTrades.length} trades via manager._apiCall.`);
    } catch (err) {
      logger.warn(`manager._apiCall GetTradeHistory failed: ${(err as Error).message}. Trying direct fetch…`);
    }
  }

  // Method 1B: Direct HTTP fetch fallback
  if (!apiTrades && (apiKey ?? accessToken)) {
    try {
      const param = apiKey
        ? `key=${apiKey}`
        : `access_token=${encodeURIComponent(accessToken!)}`;
      const url = `https://api.steampowered.com/IEconService/GetTradeHistory/v1/?${param}&max_trades=100&include_failed=1`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json() as any;
        apiTrades = data?.response?.trades ?? null;
        if (apiTrades) logger.info(`Fetched ${apiTrades.length} trades via direct fetch.`);
      } else {
        logger.warn(`Steam WebAPI returned HTTP ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      logger.warn(`Direct Steam WebAPI fetch failed: ${(err as Error).message}`);
    }
  }

  if (apiTrades && apiTrades.length > 0) {
    for (const t of apiTrades) {
      const matchesTradeId =
        trackedTrade.tradeId && String(t.tradeid) === trackedTrade.tradeId;
      const matchesPartner =
        trackedTrade.partnerSteamId64 && String(t.steamid_other) === trackedTrade.partnerSteamId64;
      const isWithinTimeframe =
        Math.abs(t.time_init * 1000 - trackedTrade.acceptedAt) < 48 * 60 * 60 * 1000;

      let matchesAsset = false;
      if (Array.isArray(t.assets_received)) {
        matchesAsset = t.assets_received.some((asset: any) =>
          trackedTrade.items.some(
            (it) => it.assetid === String(asset.assetid) || it.assetid === String(asset.new_assetid),
          ),
        );
      }

      if (matchesTradeId || (matchesPartner && isWithinTimeframe) || matchesAsset) {
        if (!trackedTrade.tradeId && t.tradeid) {
          trackedTrade.tradeId = String(t.tradeid);
        }
        logger.info(
          `Matched trade record: TradeID=${t.tradeid}, Status=${t.status} for transaction ${trackedTrade.transactionId}`,
        );
        if (ROLLBACK_STATUSES.has(Number(t.status))) {
          logger.info(`Rollback confirmed via Steam WebAPI (status: ${t.status}) for transaction ${trackedTrade.transactionId}!`);
          return true;
        }
      }
    }
  }

  // Method 2: Web session HTML scrape fallback
  if (manager._community) {
    try {
      const html = await new Promise<string>((resolve, reject) => {
        manager._community.httpRequestGet(
          'https://steamcommunity.com/my/tradehistory/',
          (err: Error | null, _res: unknown, body: string) =>
            err ? reject(err) : resolve(body ?? ''),
        );
      });

      if (html) {
        let partnerAccountId32: string | null = null;
        if (trackedTrade.partnerSteamId64) {
          try {
            partnerAccountId32 = (BigInt(trackedTrade.partnerSteamId64) & 0xFFFFFFFFn).toString();
          } catch {
            // non-fatal
          }
        }

        const rows = html.split(/<div class="tradehistoryrow/i);
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i] ?? '';
          const hasTradeId = trackedTrade.tradeId && row.includes(trackedTrade.tradeId);
          const hasSteamId64 = trackedTrade.partnerSteamId64 && row.includes(trackedTrade.partnerSteamId64);
          const hasAccountId32 =
            partnerAccountId32 &&
            (row.includes(`miniprofile="${partnerAccountId32}"`) ||
              row.includes(`miniprofile='${partnerAccountId32}'`));
          const hasItemName = trackedTrade.items.some(
            (it) => it.market_hash_name && row.includes(it.market_hash_name),
          );

          if (hasTradeId || hasSteamId64 || hasAccountId32 || hasItemName) {
            const isRollback =
              /tradehistory_rollback|trade_reversal|reversed|rollback|trade protection|protecci[oó]n|revertid[oa]|devuelt[oa]/i.test(row);
            if (isRollback) {
              logger.info(`Rollback confirmed via HTML trade history for transaction ${trackedTrade.transactionId}!`);
              return true;
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`HTML rollback check failed: ${(err as Error).message}`);
    }
  }

  return false;
}
