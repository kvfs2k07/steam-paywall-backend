// index.js - Pellix Resell Bot (ES6 Modules)

import express from "express";
import SteamUser from "steam-user";
import TradeOfferManager from "steam-tradeoffer-manager";
import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";

import logger from "./logger.js";

dotenv.config();

// ==================== CONFIG desde .env ====================
const CONFIG = {
    STEAM_REFRESH_TOKEN: process.env.STEAM_REFRESH_TOKEN,
    STEAM_API_KEY: process.env.STEAM_API_KEY || null,
    WEBHOOK_URL: process.env.DEV === "true" ? process.env.API_DEV_URL : process.env.API_URL,
    PORT: process.env.PORT || 3000,
    SHARED_SECRET: process.env.SHARED_SECRET,
    MIN_ITEM_PRICE: process.env.MIN_ITEM_PRICE ? parseFloat(process.env.MIN_ITEM_PRICE) : 0.10,
};

// Validación de variables de entorno
const requiredEnv = [
    "STEAM_REFRESH_TOKEN",
];
for (const key of requiredEnv) {
    if (!process.env[key]) {
        logger.error(`Missing required environment variable: ${key}`);
        process.exit(1);
    }
}

if (!CONFIG.WEBHOOK_URL) {
    logger.error("Missing required environment variable: API_URL or API_DEV_URL");
    process.exit(1);
}

if (!CONFIG.SHARED_SECRET) {
    logger.error("SHARED_SECRET is not set or is empty. Please fill it in your .env file.");
    process.exit(1);
}

// ==================== PRECIOS CACHÉ ====================
let csPriceCache = {};
let rustPriceCache = {};

async function loadCSPriceCache() {
    try {
        const res = await fetch(
            "https://prices.csgotrader.app/latest/steam.json",
        );
        csPriceCache = await res.json();
        logger.info(
            `CS price cache refreshed successfully (${Object.keys(csPriceCache).length} items)`,
        );
    } catch (err) {
        logger.error(`Failed to load CS price cache: ${err.message}`);
    }
}

async function loadRustPriceCache() {
    try {
        const res = await fetch(
            "https://api.skinport.com/v1/items?app_id=252490&currency=USD",
            {
                headers: {
                    "Accept": "application/json",
                    "Accept-Encoding": "br",
                    "User-Agent": "SteamTradeBot/1.0",
                },
            },
        );
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const data = await res.json();
        if (Array.isArray(data)) {
            const cache = {};
            for (const item of data) {
                if (item.market_hash_name) {
                    cache[item.market_hash_name] = item;
                }
            }
            rustPriceCache = cache;
            logger.info(
                `Rust price cache refreshed successfully (${Object.keys(rustPriceCache).length} items from Skinport)`,
            );
        } else {
            logger.warn("Unexpected Rust price response format from Skinport");
        }
    } catch (err) {
        logger.error(`Failed to load Rust price cache: ${err.message}`);
    }
}

async function loadPriceCache() {
    await Promise.all([loadCSPriceCache(), loadRustPriceCache()]);
}

function getCSPrice(marketHashName) {
    if (!csPriceCache || !marketHashName) return 0;

    const item = csPriceCache[marketHashName];
    if (!item) return 0;

    if (item.last_24h !== null && item.last_24h > 0) return item.last_24h;
    if (item.last_7d !== null && item.last_7d > 0) return item.last_7d;
    if (item.last_30d !== null && item.last_30d > 0) return item.last_30d;
    if (item.last_90d !== null && item.last_90d > 0) return item.last_90d;

    return 0;
}

function getRustPrice(marketHashName) {
    if (!rustPriceCache || !marketHashName) return 0;

    const item = rustPriceCache[marketHashName];
    if (!item) return 0;

    // Skinport suggested_price (standard market estimate), with fallbacks to other pricing metrics
    if (item.suggested_price !== null && item.suggested_price !== undefined && item.suggested_price > 0) {
        return item.suggested_price;
    }
    if (item.min_price !== null && item.min_price !== undefined && item.min_price > 0) {
        return item.min_price;
    }
    if (item.median_price !== null && item.median_price !== undefined && item.median_price > 0) {
        return item.median_price;
    }
    if (item.mean_price !== null && item.mean_price !== undefined && item.mean_price > 0) {
        return item.mean_price;
    }

    return 0;
}

function getItemPrice(itemOrName, appId) {
    let name = "";
    let app = appId;

    if (typeof itemOrName === "object" && itemOrName !== null) {
        name = itemOrName.market_hash_name;
        if (!app && itemOrName.appid) {
            app = Number(itemOrName.appid);
        }
    } else if (typeof itemOrName === "string") {
        name = itemOrName;
    }

    if (!name) return 0;

    // Rust (AppID 252490)
    if (app === 252490) {
        return getRustPrice(name);
    }

    // CS:GO / CS2 (AppID 730)
    if (app === 730) {
        return getCSPrice(name);
    }

    // Fallback if appid is not specified: check Rust then CS
    const rustPrice = getRustPrice(name);
    if (rustPrice > 0) return rustPrice;

    return getCSPrice(name);
}

const getSkinPrice = getItemPrice;

// ==================== CACHE API ====================
const CACHE_FILE = 'trade_cache.json';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

const tradeRequestsCache = new Map();

function saveCache() {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(tradeRequestsCache)));
    } catch (err) {
        logger.error(`Failed to save cache: ${err.message}`);
    }
}

function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            const now = Date.now();
            let hasExpired = false;
            
            for (const [key, value] of Object.entries(data)) {
                if (now - value.createdAt > CACHE_TTL) {
                    hasExpired = true;
                } else {
                    tradeRequestsCache.set(key, value);
                }
            }
            
            if (hasExpired) saveCache();
            logger.info(`Loaded ${tradeRequestsCache.size} trade requests from cache.`);
        }
    } catch (err) {
        logger.error(`Failed to load cache: ${err.message}`);
    }
}

function cleanExpiredCache() {
    const now = Date.now();
    let hasExpired = false;
    for (const [key, value] of tradeRequestsCache.entries()) {
        if (now - value.createdAt > CACHE_TTL) {
            tradeRequestsCache.delete(key);
            hasExpired = true;
        }
    }
    if (hasExpired) saveCache();
}

// Limpiar expirados cada hora
setInterval(cleanExpiredCache, 60 * 60 * 1000);

// ==================== 7-DAY TRADE PROTECTION TRACKING ====================
const TRACKED_TRADES_FILE = 'tracked_trades.json';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const trackedTrades = new Map();

function saveTrackedTrades() {
    try {
        fs.writeFileSync(TRACKED_TRADES_FILE, JSON.stringify(Object.fromEntries(trackedTrades), null, 2));
    } catch (err) {
        logger.error(`Failed to save tracked trades: ${err.message}`);
    }
}

function loadTrackedTrades() {
    try {
        if (fs.existsSync(TRACKED_TRADES_FILE)) {
            const data = JSON.parse(fs.readFileSync(TRACKED_TRADES_FILE, 'utf8'));
            const now = Date.now();
            let hasExpired = false;

            for (const [key, value] of Object.entries(data)) {
                if (now - value.acceptedAt > SEVEN_DAYS_MS) {
                    hasExpired = true;
                } else {
                    trackedTrades.set(key, value);
                }
            }

            if (hasExpired) saveTrackedTrades();
            logger.info(`Loaded ${trackedTrades.size} trade(s) being monitored for 7-day Trade Protection.`);
        }
    } catch (err) {
        logger.error(`Failed to load tracked trades: ${err.message}`);
    }
}

const app = express();
app.use(express.json());

app.post('/api/trade-request', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${CONFIG.SHARED_SECRET}`) {
        logger.warn(`Unauthorized API request from ${req.ip}`);
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { id, steamId, steamId64, senderSteamId } = req.body;
    const targetSteamId = (steamId64 || steamId || senderSteamId || "").toString().trim();
    
    if (!id) {
        return res.status(400).json({ error: "Missing required 'id' field" });
    }
    
    // Si este SteamID64 ya tenía una solicitud pendiente, eliminar la anterior
    if (targetSteamId) {
        for (const [oldId, oldData] of tradeRequestsCache.entries()) {
            if (oldData.steamId64 === targetSteamId) {
                logger.info(`Superseding previous trade request ${oldId} for SteamID64 ${targetSteamId} with new request ${id}`);
                tradeRequestsCache.delete(oldId);
            }
        }
    }

    tradeRequestsCache.set(id.toString(), {
        steamId64: targetSteamId || null,
        createdAt: Date.now()
    });
    saveCache();
    
    logger.info(`New trade request cached: ID=${id}${targetSteamId ? ` (SteamID64=${targetSteamId})` : " (No SteamID64 specified, fallback to note only)"}`);
    res.json({ success: true, message: "Trade request cached successfully" });
});

app.listen(CONFIG.PORT, () => {
    logger.info(`Express API server listening on port ${CONFIG.PORT}`);
});

// ==================== STEAM SETUP ====================
let currentAccessToken = null;
const steamClient = new SteamUser();
const manager = new TradeOfferManager({
    steam: steamClient,
    domain: "localhost",
    language: "en",
    pollInterval: 5000,
    cancelTime: 0,
});

steamClient.logOn({
    refreshToken: CONFIG.STEAM_REFRESH_TOKEN,
});

steamClient.on("loggedOn", () => {
    logger.info("Steam client logged in");
    steamClient.setPersona(SteamUser.EPersonaState.Online);
});

steamClient.on("webSession", (sessionID, cookies) => {
    try {
        const loginCookie = (cookies || []).find((c) => c && c.startsWith("steamLoginSecure="));
        if (loginCookie) {
            const val = decodeURIComponent(loginCookie.substring("steamLoginSecure=".length));
            const parts = val.split("||");
            if (parts.length > 1 && parts[1]) {
                currentAccessToken = parts[1];
            }
        }
    } catch (e) {
        // ignore parsing error
    }

    manager.setCookies(cookies, (err) => {
        if (err) {
            logger.error(`Error setting cookies on TradeOfferManager: ${err.message}`);
            return;
        }
        if (!manager.accessToken && currentAccessToken) {
            manager.accessToken = currentAccessToken;
        }
        const hasKey = Boolean(CONFIG.STEAM_API_KEY || manager.apiKey);
        const hasToken = Boolean(manager.accessToken || currentAccessToken);
        logger.info(
            `Steam Trade Manager ready (API Key: ${hasKey ? "Available" : "Not Found"} | Access Token: ${hasToken ? "Available" : "Not Found"})`,
        );
    });
});

steamClient.on("disconnected", (eresult, msg) => {
    logger.warn(`Steam client disconnected: ${msg || "No message"} (EResult: ${eresult})`);
});

steamClient.on("error", (err) => {
    logger.error(`Steam client error: ${err.message} (EResult: ${err.eresult})`);

    // EResult 34 = LogonSessionReplaced (another client logged into this Steam account)
    if (err.eresult === SteamUser.EResult.LogonSessionReplaced) {
        logger.warn(
            "Another session logged into this Steam account. Waiting 30s before attempting to reconnect...",
        );
        setTimeout(() => {
            try {
                steamClient.logOn({ refreshToken: CONFIG.STEAM_REFRESH_TOKEN });
            } catch (reconnectErr) {
                logger.error(`Failed to relog on: ${reconnectErr.message}`);
            }
        }, 30000);
    }

    // EResult 15 = AccessDenied (token revoked or expired)
    if (err.eresult === SteamUser.EResult.AccessDenied) {
        logger.error(
            "STEAM_REFRESH_TOKEN has been revoked or expired by Steam! Please generate a new token using 'node get-token.js' and update your .env.",
        );
    }
});

manager.on("error", (err) => {
    logger.error(`TradeOfferManager error: ${err.message}`);
});

process.on("unhandledRejection", (reason, promise) => {
    logger.error(`Unhandled Rejection: ${reason}`);
});

process.on("uncaughtException", (err) => {
    logger.error(`Uncaught Exception: ${err.stack || err.message}`);
});

// ==================== TRADE HANDLER ====================
manager.on("newOffer", async (offer) => {
    if (offer.isOurOffer) return;

    const partner = offer.partner.toString();
    const note = offer.message?.trim() || "";

    // Ignore if the sender wants items from the bot
    if (offer.itemsToGive.length > 0) {
        logger.warn(`Ignoring trade from ${partner}: they requested items from our inventory.`);
        return;
    }

    // Ignore if the offer contains no items
    if (offer.itemsToReceive.length === 0) {
        logger.warn(`Ignoring trade from ${partner}: offer contains no items.`);
        return;
    }

    // Find matching trade request (SteamID64 first, note as fallback)
    const tradeId = findMatchingTradeId(partner, note);
    if (!tradeId) {
        logger.warn(`Ignoring trade from ${partner}: no matching request found (SteamID64: ${partner}, note: "${note}").`);
        return;
    }

    const requestData = tradeRequestsCache.get(tradeId);
    if (!requestData) {
        logger.warn(`Ignoring trade from ${partner}: ID "${tradeId}" not found in cache.`);
        return;
    }

    // Calcular valor
    const items = offer.itemsToReceive;
    let totalValue = 0;
    let ignoredItemsCount = 0;

    for (const item of items) {
        if (item.market_hash_name) {
            const price = getItemPrice(item);
            if (price >= CONFIG.MIN_ITEM_PRICE) {
                totalValue += price;
            } else {
                ignoredItemsCount++;
                logger.warn(
                    `Item "${item.market_hash_name}" (AppID ${item.appid}) ignored: price ($${price.toFixed(2)}) is below minimum ($${CONFIG.MIN_ITEM_PRICE.toFixed(2)})`,
                );
            }
        }
    }

    if (ignoredItemsCount > 0) {
        logger.info(`${ignoredItemsCount} item(s) were excluded from trade ${tradeId} because they were below $${CONFIG.MIN_ITEM_PRICE.toFixed(2)}.`);
    }

    logger.info(`Trade offer for ID ${tradeId} received with total valid value of $${totalValue.toFixed(2)}`);

    // Notificar al Webhook
    try {
        const response = await fetch(CONFIG.WEBHOOK_URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.SHARED_SECRET}`
            },
            body: JSON.stringify({
                transactionId: tradeId,
                amount: totalValue
            })
        });

        const rawText = await response.text();
        let data;
        try {
            data = JSON.parse(rawText);
        } catch (jsonErr) {
            logger.error(`Webhook returned non-JSON response (HTTP ${response.status} ${response.statusText}): ${rawText.slice(0, 300)}`);
            try { await offer.cancel(); } catch (cancelErr) {}
            return;
        }

        if (data.accept === true) {
            try {
                const status = await acceptOfferAsync(offer);
                logger.info(`Trade offer for ID ${tradeId} accepted on Steam (status: ${status}).`);
                await registerAcceptedTradeForTracking(offer, tradeId, Number(totalValue.toFixed(2)));
            } catch (acceptErr) {
                logger.error(`Error accepting trade offer for ID ${tradeId} on Steam: ${acceptErr.message}`);
            }
        } else {
            try { await cancelOfferAsync(offer); } catch (cancelErr) {}
            logger.warn(`Trade offer for ID ${tradeId} was rejected by webhook (Reason: ${data.reason || "None specified"}). Cancelled trade.`);
        }
    } catch (err) {
        logger.error(`Error processing webhook for ID ${tradeId}: ${err.message}`);
        try {
            await cancelOfferAsync(offer);
        } catch (cancelErr) {}
    } finally {
        // Eliminar del caché siempre para evitar reusos/bugs
        tradeRequestsCache.delete(tradeId);
        saveCache();
    }
});

function findMatchingTradeId(partnerSteamId, note) {
    const cleanNote = (note || "").trim();

    // 1. Primary: Match by sender SteamID64
    if (partnerSteamId) {
        for (const [id, data] of tradeRequestsCache.entries()) {
            if (data.steamId64 && data.steamId64 === partnerSteamId) {
                logger.info(`Trade matched via sender SteamID64 (${partnerSteamId}) for ID: ${id}`);
                return id;
            }
        }
    }

    // 2. Fallback: Match by trade note
    if (cleanNote) {
        // Exact match
        if (tradeRequestsCache.has(cleanNote)) {
            const data = tradeRequestsCache.get(cleanNote);
            if (!data.steamId64 || data.steamId64 === partnerSteamId) {
                logger.info(`Trade matched via note fallback for ID: ${cleanNote}`);
                return cleanNote;
            }
        }

        // Substring match
        for (const [id, data] of tradeRequestsCache.entries()) {
            if (cleanNote.includes(id)) {
                if (!data.steamId64 || data.steamId64 === partnerSteamId) {
                    logger.info(`Trade matched via note substring fallback for ID: ${id}`);
                    return id;
                }
            }
        }
    }

    return null;
}

function acceptOfferAsync(offer) {
    return new Promise((resolve, reject) => {
        offer.accept((err, status) => {
            if (err) return reject(err);
            resolve(status);
        });
    });
}

function cancelOfferAsync(offer) {
    return new Promise((resolve, reject) => {
        offer.cancel((err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

// ==================== 7-DAY ROLLBACK & REVERSAL DETECTION ====================

async function registerAcceptedTradeForTracking(offer, transactionId, amount = 0) {
    try {
        let receivedItems = [];

        // Retry getReceivedItems up to 3 times to allow Steam receipt to be ready
        for (let attempt = 1; attempt <= 3; attempt++) {
            await new Promise((r) => setTimeout(r, 1500 * attempt));
            try {
                receivedItems = await new Promise((resolve, reject) => {
                    offer.getReceivedItems(false, (err, items) => {
                        if (err) return reject(err);
                        resolve(items || []);
                    });
                });
                if (receivedItems && receivedItems.length > 0) {
                    break;
                }
            } catch (err) {
                if (attempt === 3) {
                    logger.warn(`Could not get new asset IDs via getReceivedItems for offer ${offer.id}: ${err.message}`);
                }
            }
        }

        const itemsToTrack = [];
        if (receivedItems && receivedItems.length > 0) {
            for (const item of receivedItems) {
                itemsToTrack.push({
                    assetid: String(item.assetid),
                    appid: Number(item.appid),
                    contextid: String(item.contextid || "2"),
                    market_hash_name: item.market_hash_name || item.name || "",
                });
            }
        } else {
            // Fallback to itemsToReceive if getReceivedItems is not yet ready
            for (const item of offer.itemsToReceive) {
                itemsToTrack.push({
                    assetid: String(item.assetid),
                    appid: Number(item.appid),
                    contextid: String(item.contextid || "2"),
                    market_hash_name: item.market_hash_name || item.name || "",
                });
            }
        }

        trackedTrades.set(transactionId, {
            transactionId: transactionId,
            offerId: String(offer.id),
            tradeId: offer.tradeID ? String(offer.tradeID) : null,
            partnerSteamId64: offer.partner ? offer.partner.toString() : null,
            acceptedAt: Date.now(),
            amount: typeof amount === "number" ? amount : 0,
            items: itemsToTrack,
        });
        saveTrackedTrades();

        logger.info(
            `Started 7-day Trade Protection tracking for transaction ${transactionId} (${itemsToTrack.length} item(s) monitored, amount: $${amount}).`,
        );
    } catch (err) {
        logger.error(`Error registering trade for 7-day tracking: ${err.message}`);
    }
}

function getBotInventory(appid, contextid = 2) {
    return new Promise((resolve, reject) => {
        manager.getInventoryContents(appid, contextid, false, (err, inventory) => {
            if (err) return reject(err);
            resolve(inventory || []);
        });
    });
}

async function checkSteamTradeRollback(trackedTrade) {
    const apiKey = CONFIG.STEAM_API_KEY || manager.apiKey;
    const accessToken = manager.accessToken || currentAccessToken;

    logger.info(
        `Checking trade rollback for transaction ${trackedTrade.transactionId} (tradeId: ${trackedTrade.tradeId || "none"}, partner: ${trackedTrade.partnerSteamId64 || "none"})...`,
    );

    // =========================================================================
    // METHOD 1: Steam WebAPI IEconService/GetTradeHistory
    // Works with either API Key OR Access Token (bypasses the $5 account limit!)
    // =========================================================================
    let apiTrades = null;

    // 1A. Try via manager._apiCall (uses manager's HTTP client with session/cookies)
    if (apiKey || accessToken) {
        try {
            const apiRes = await new Promise((resolve, reject) => {
                manager._apiCall(
                    'GET',
                    { iface: 'IEconService', method: 'GetTradeHistory' },
                    1,
                    { max_trades: 100, include_failed: 1, include_total: 1 },
                    (err, body) => {
                        if (err) return reject(err);
                        resolve(body);
                    },
                );
            });

            if (apiRes && apiRes.response && Array.isArray(apiRes.response.trades)) {
                apiTrades = apiRes.response.trades;
                logger.info(`Fetched ${apiTrades.length} trades from Steam WebAPI via manager._apiCall.`);
            } else if (apiRes && Array.isArray(apiRes.trades)) {
                apiTrades = apiRes.trades;
                logger.info(`Fetched ${apiTrades.length} trades from Steam WebAPI via manager._apiCall.`);
            }
        } catch (callErr) {
            logger.warn(`manager._apiCall GetTradeHistory failed: ${callErr.message}. Trying direct fetch...`);
        }
    }

    // 1B. Direct fetch fallback with access_token or apiKey if 1A didn't return trades
    if (!apiTrades && (apiKey || accessToken)) {
        try {
            const param = apiKey ? `key=${apiKey}` : `access_token=${encodeURIComponent(accessToken)}`;
            const url = `https://api.steampowered.com/IEconService/GetTradeHistory/v1/?${param}&max_trades=100&include_failed=1`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                if (data?.response?.trades && Array.isArray(data.response.trades)) {
                    apiTrades = data.response.trades;
                    logger.info(`Fetched ${apiTrades.length} trades from Steam WebAPI via direct fetch.`);
                }
            } else {
                logger.warn(`Direct Steam WebAPI returned HTTP ${res.status} ${res.statusText}`);
            }
        } catch (fetchErr) {
            logger.warn(`Direct fetch to Steam WebAPI failed: ${fetchErr.message}`);
        }
    }

    // If we got trades from WebAPI, inspect them!
    if (apiTrades && apiTrades.length > 0) {
        // Steam EEconTradeStatus rollback codes (12 is Steam Trade Protection rollback)
        const ROLLBACK_STATUSES = [5, 6, 7, 8, 9, 11, 12];

        for (const t of apiTrades) {
            const matchesTradeId = trackedTrade.tradeId && String(t.tradeid) === String(trackedTrade.tradeId);
            const matchesPartner = trackedTrade.partnerSteamId64 && String(t.steamid_other) === String(trackedTrade.partnerSteamId64);
            const isWithinTimeframe = Math.abs((t.time_init * 1000) - trackedTrade.acceptedAt) < 48 * 60 * 60 * 1000;

            let matchesAsset = false;
            if (t.assets_received && Array.isArray(t.assets_received)) {
                for (const asset of t.assets_received) {
                    if (
                        trackedTrade.items.some(
                            (it) =>
                                it.assetid === String(asset.assetid) ||
                                it.assetid === String(asset.new_assetid),
                        )
                    ) {
                        matchesAsset = true;
                        break;
                    }
                }
            }

            if (matchesTradeId || (matchesPartner && isWithinTimeframe) || matchesAsset) {
                // If tradeId was missing on the tracked trade, save it now
                if (!trackedTrade.tradeId && t.tradeid) {
                    trackedTrade.tradeId = String(t.tradeid);
                    saveTrackedTrades();
                }

                logger.info(
                    `Matched trade history record: TradeID=${t.tradeid}, Status=${t.status} for transaction ${trackedTrade.transactionId}`,
                );

                if (ROLLBACK_STATUSES.includes(Number(t.status))) {
                    logger.info(
                        `Rollback confirmed via Steam WebAPI (status: ${t.status}) for transaction ${trackedTrade.transactionId}!`,
                    );
                    return true;
                }
            }
        }
    }

    // =========================================================================
    // METHOD 2: Web Session HTML Scraper Fallback
    // Robust parsing using AccountID32, Item Name, and multi-language rollback detection
    // =========================================================================
    if (manager._community) {
        try {
            const html = await new Promise((resolve, reject) => {
                manager._community.httpRequestGet('https://steamcommunity.com/my/tradehistory/', (err, res, body) => {
                    if (err) return reject(err);
                    resolve(body || "");
                });
            });

            if (html) {
                let partnerAccountId32 = null;
                if (trackedTrade.partnerSteamId64) {
                    try {
                        partnerAccountId32 = (BigInt(trackedTrade.partnerSteamId64) & 0xFFFFFFFFn).toString();
                    } catch (e) {}
                }

                // Check trade rows in HTML
                const rows = html.split(/<div class="tradehistoryrow/i);
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];

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
                            /tradehistory_rollback|trade_reversal|reversed|rollback|trade protection|protecci[oó]n|revertid[oa]|devuelt[oa]/i.test(
                                row,
                            );

                        if (isRollback) {
                            logger.info(
                                `Trade rollback confirmed via web session trade history HTML for transaction ${trackedTrade.transactionId}!`,
                            );
                            return true;
                        }
                    }
                }
            }
        } catch (webErr) {
            logger.warn(`Could not verify trade rollback via web trade history HTML: ${webErr.message}`);
        }
    }

    return false;
}

async function notifyWebhookReversal(trackedTrade) {
    try {
        let tradeAmount = typeof trackedTrade.amount === "number" ? trackedTrade.amount : 0;
        if (!tradeAmount && trackedTrade.items && trackedTrade.items.length > 0) {
            for (const it of trackedTrade.items) {
                tradeAmount += getItemPrice(it.market_hash_name, it.appid);
            }
            tradeAmount = Number(tradeAmount.toFixed(2));
        }

        const response = await fetch(CONFIG.WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.SHARED_SECRET}`,
            },
            body: JSON.stringify({
                transactionId: trackedTrade.transactionId,
                amount: tradeAmount,
                status: "reversed",
                event: "trade_reversed",
                tradeId: trackedTrade.tradeId || null,
                offerId: trackedTrade.offerId || null,
                partnerSteamId64: trackedTrade.partnerSteamId64 || null,
                reason: "Trade was rolled back via Steam Trade Protection (status 12)",
            }),
        });

        const rawText = await response.text();
        logger.info(
            `Webhook reversal notification sent for transaction ${trackedTrade.transactionId} (HTTP ${response.status}): ${rawText.slice(0, 150)}`,
        );
    } catch (err) {
        logger.error(
            `Failed to notify webhook of trade reversal for ${trackedTrade.transactionId}: ${err.message}`,
        );
    }
}

async function checkTrackedTrades() {
    if (trackedTrades.size === 0) return;

    const now = Date.now();
    let hasPruned = false;

    // 1. Prune trades older than 7 days (safe from rollback)
    for (const [id, trade] of trackedTrades.entries()) {
        if (now - trade.acceptedAt > SEVEN_DAYS_MS) {
            logger.info(
                `Transaction ${id} passed the 7-day Trade Protection window safely. Monitoring ended.`,
            );
            trackedTrades.delete(id);
            hasPruned = true;
        }
    }
    if (hasPruned) saveTrackedTrades();

    if (trackedTrades.size === 0) return;

    // 2. Identify distinct AppIDs to check
    const appIdsToCheck = new Set();
    for (const trade of trackedTrades.values()) {
        for (const item of trade.items) {
            if (item.appid) appIdsToCheck.add(item.appid);
        }
    }

    // 3. Fetch bot's inventory for each AppID
    const currentInventoryAssetIds = new Set();
    for (const appid of appIdsToCheck) {
        try {
            const inventory = await getBotInventory(appid);
            for (const item of inventory) {
                currentInventoryAssetIds.add(String(item.assetid));
            }
        } catch (err) {
            logger.warn(
                `Failed to fetch bot inventory for AppID ${appid} during rollback check: ${err.message}. Skipping this cycle to prevent false positives.`,
            );
            return;
        }
    }

    // 4. Verify items for each tracked trade
    for (const [id, trade] of trackedTrades.entries()) {
        let missingItem = null;
        for (const item of trade.items) {
            if (!currentInventoryAssetIds.has(String(item.assetid))) {
                missingItem = item;
                break;
            }
        }

        if (missingItem) {
            logger.warn(
                `Tracked item "${missingItem.market_hash_name}" (${missingItem.assetid}) for transaction ${id} is MISSING from inventory. Checking Steam trade history for rollback...`,
            );

            const isRolledBack = await checkSteamTradeRollback(trade);
            if (isRolledBack) {
                logger.error(
                    `Trade rollback CONFIRMED by Steam for transaction ${id}! Sending webhook alert...`,
                );
                await notifyWebhookReversal(trade);
                trackedTrades.delete(id);
                saveTrackedTrades();
            } else {
                logger.info(
                    `Steam trade history did not report a rollback for transaction ${id}. Item may have been moved or Steam inventory is syncing.`,
                );
            }
        }
    }
}

// ==================== START ====================
(async () => {
    if (!fs.existsSync("logs")) {
        fs.mkdirSync("logs");
    }

    loadCache();
    loadTrackedTrades();
    await loadPriceCache();
    
    // Refrescar caché de precios cada hora
    setInterval(loadPriceCache, 60 * 60 * 1000);

    // Verificar items en tracking de Trade Protection cada 15 minutos
    setInterval(checkTrackedTrades, 15 * 60 * 1000);

    // Verificación inicial 30 segundos tras el arranque
    setTimeout(checkTrackedTrades, 30 * 1000);
})();
