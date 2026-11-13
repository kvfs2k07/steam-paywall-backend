// test-protection.js - Diagnostic & Troubleshooting Tool for Trade Protection
import fs from 'fs';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import SteamUser from 'steam-user';

dotenv.config();

const CONFIG = {
    WEBHOOK_URL: process.env.DEV === "true" ? process.env.API_DEV_URL : process.env.API_URL,
    SHARED_SECRET: process.env.SHARED_SECRET,
    STEAM_API_KEY: process.env.STEAM_API_KEY,
    STEAM_REFRESH_TOKEN: process.env.STEAM_REFRESH_TOKEN,
};

console.log("==================================================");
console.log("   TRADE PROTECTION DIAGNOSTIC & TEST HARNESS     ");
console.log("==================================================\n");

async function runDiagnostics() {
    // -----------------------------------------------------------------
    // TEST 1: Inspect tracked_trades.json
    // -----------------------------------------------------------------
    console.log("▶ TEST 1: Checking tracked_trades.json...");
    let firstTrade = null;
    if (!fs.existsSync("tracked_trades.json")) {
        console.log("  ℹ No tracked_trades.json found yet (no accepted trades tracked).\n");
    } else {
        try {
            const raw = fs.readFileSync("tracked_trades.json", "utf8");
            const data = JSON.parse(raw);
            const keys = Object.keys(data);
            console.log(`  ✔ Found ${keys.length} active trade(s) being tracked.`);

            const now = Date.now();
            const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

            keys.forEach((id) => {
                const trade = data[id];
                if (!firstTrade) firstTrade = trade;
                const ageHours = ((now - trade.acceptedAt) / (1000 * 60 * 60)).toFixed(1);
                const remainingHours = Math.max(0, ((SEVEN_DAYS_MS - (now - trade.acceptedAt)) / (1000 * 60 * 60))).toFixed(1);
                console.log(`    - ID: ${id}`);
                console.log(`      Offer ID: ${trade.offerId || "N/A"} | Trade ID: ${trade.tradeId || "N/A"}`);
                console.log(`      Partner SteamID64: ${trade.partnerSteamId64 || "N/A"}`);
                console.log(`      Items Tracked: ${trade.items ? trade.items.length : 0}`);
                if (trade.items) {
                    trade.items.forEach((it) => console.log(`        • ${it.market_hash_name} (${it.assetid})`));
                }
                console.log(`      Age: ${ageHours}h / 168h (${remainingHours}h remaining until safe)`);
            });
            console.log("");
        } catch (err) {
            console.log(`  ✖ Error reading tracked_trades.json: ${err.message}\n`);
        }
    }

    // -----------------------------------------------------------------
    // TEST 2: Test Steam Web API GetTradeHistory (via API Key or Web Session Access Token)
    // -----------------------------------------------------------------
    console.log("▶ TEST 2: Testing Steam IEconService/GetTradeHistory (WebAPI & Access Token)...");
    if (CONFIG.STEAM_API_KEY) {
        try {
            const url = `https://api.steampowered.com/IEconService/GetTradeHistory/v1/?key=${CONFIG.STEAM_API_KEY}&max_trades=10&include_failed=1`;
            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                const trades = json?.response?.trades || [];
                console.log(`  ✔ Steam Web API responded OK via STEAM_API_KEY (${res.status}). Found ${trades.length} recent trade(s):`);
                trades.slice(0, 5).forEach((t) => {
                    console.log(`    - Trade #${t.tradeid} | Partner: ${t.steamid_other} | Status: ${t.status}${t.status === 12 ? " (ROLLBACK / REVERSED!)" : ""}`);
                });
                console.log("");
            } else {
                console.log(`  ✖ Steam Web API returned HTTP ${res.status} ${res.statusText}.\n`);
            }
        } catch (err) {
            console.log(`  ✖ Failed to connect to Steam Web API: ${err.message}\n`);
        }
    } else {
        console.log("  ℹ STEAM_API_KEY not set. Testing Web Session Access Token (bypasses $5 limit)...");
        if (CONFIG.STEAM_REFRESH_TOKEN) {
            await new Promise((resolve) => {
                const testClient = new SteamUser();
                const timer = setTimeout(() => {
                    console.log("  ✖ Steam login timed out after 15s.\n");
                    try { testClient.logOff(); } catch (e) {}
                    resolve();
                }, 15000);

                testClient.logOn({ refreshToken: CONFIG.STEAM_REFRESH_TOKEN });

                testClient.on('error', (err) => {
                    clearTimeout(timer);
                    console.log(`  ✖ Steam login error: ${err.message}\n`);
                    resolve();
                });

                testClient.on('webSession', async (sessionId, cookies) => {
                    clearTimeout(timer);
                    try {
                        const loginCookie = (cookies || []).find((c) => c && c.startsWith("steamLoginSecure="));
                        let accessToken = null;
                        if (loginCookie) {
                            const val = decodeURIComponent(loginCookie.substring("steamLoginSecure=".length));
                            const parts = val.split("||");
                            if (parts.length > 1 && parts[1]) {
                                accessToken = parts[1];
                            }
                        }

                        if (!accessToken) {
                            console.log("  ✖ Could not extract access token from steamLoginSecure cookie.\n");
                            testClient.logOff();
                            return resolve();
                        }

                        console.log("  ✔ Successfully obtained Steam OAuth Access Token from Web Session.");
                        const url = `https://api.steampowered.com/IEconService/GetTradeHistory/v1/?access_token=${encodeURIComponent(accessToken)}&max_trades=10&include_failed=1`;
                        const res = await fetch(url);
                        if (res.ok) {
                            const json = await res.json();
                            const trades = json?.response?.trades || [];
                            console.log(`  ✔ Steam Web API responded OK via Access Token (${res.status})! Found ${trades.length} recent trade(s):`);
                            trades.slice(0, 5).forEach((t) => {
                                console.log(`    - Trade #${t.tradeid} | Partner: ${t.steamid_other} | Status: ${t.status}${t.status === 12 ? " (ROLLBACK / REVERSED!)" : ""}`);
                            });
                            console.log("");
                        } else {
                            console.log(`  ✖ Steam Web API returned HTTP ${res.status} ${res.statusText} using Access Token.\n`);
                        }
                    } catch (err) {
                        console.log(`  ✖ Error during Web Session test: ${err.message}\n`);
                    } finally {
                        try { testClient.logOff(); } catch (e) {}
                        resolve();
                    }
                });
            });
        } else {
            console.log("  ✖ STEAM_REFRESH_TOKEN is not configured in .env.\n");
        }
    }

    // -----------------------------------------------------------------
    // TEST 3: Test Webhook Reversal Notification to Your Panel
    // -----------------------------------------------------------------
    console.log(`▶ TEST 3: Testing Webhook Reversal to Panel (${CONFIG.WEBHOOK_URL})...`);
    if (!CONFIG.WEBHOOK_URL) {
        console.log("  ✖ WEBHOOK_URL is not configured!\n");
        return;
    }

    const testPayload = {
        transactionId: firstTrade ? firstTrade.transactionId : "diagnostic-test-transaction",
        amount: 1.19,
        status: "reversed",
        event: "trade_reversed",
        reason: "DIAGNOSTIC TEST: Trade rollback simulation",
        test: true,
    };

    try {
        const res = await fetch(CONFIG.WEBHOOK_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${CONFIG.SHARED_SECRET}`,
            },
            body: JSON.stringify(testPayload),
        });

        const rawText = await res.text();
        console.log(`  HTTP Status: ${res.status} ${res.statusText}`);
        console.log(`  Response: ${rawText.slice(0, 300)}`);

        if (res.ok) {
            console.log("  ✔ Panel successfully received and accepted the reversal payload.\n");
        } else {
            console.log("  ✖ Panel rejected or failed the reversal webhook payload.\n");
        }
    } catch (err) {
        console.log(`  ✖ Failed to send webhook to panel: ${err.message}\n`);
    }

    console.log("==================================================");
    console.log("             DIAGNOSTICS COMPLETE                 ");
    console.log("==================================================");
    process.exit(0);
}

runDiagnostics();