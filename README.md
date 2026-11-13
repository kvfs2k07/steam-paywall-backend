# Steam Paywall Backend

A TypeScript-based Steam tradebot that acts as the skin-payment processing backend for the store website. It receives trade requests from the store API, accepts incoming CS2/Rust skin trades, and monitors accepted trades for 7-day Steam Trade Protection rollbacks.

[![PR Checks](https://github.com/kvfs2k07/steam-paywall-backend/actions/workflows/pr.yml/badge.svg)](https://github.com/kvfs2k07/steam-paywall-backend/actions/workflows/pr.yml)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

---

## Architecture

```
the store  ──POST /api/trade-request──▶  steam-paywall-backend
                                                │
                                      listens for Steam trade offers
                                                │
                                      matches offer → trade request
                                                │
                                      POST webhook → the store
                                       (accept / reject decision)
                                                │
                                      accepts / cancels the trade
                                                │
                                      starts 7-day rollback monitor
```

## Modules

| File | Responsibility |
|---|---|
| `src/config.ts` | Loads and validates environment variables |
| `src/logger.ts` | Winston logger with daily log rotation |
| `src/prices.ts` | CS2 + Rust price caches (csgotrader.app / Skinport) |
| `src/cache.ts` | In-memory + disk cache for pending trade requests |
| `src/tracking.ts` | 7-day Trade Protection monitoring store |
| `src/matcher.ts` | Matches incoming Steam offers to cached trade requests |
| `src/webhook.ts` | Webhook client for communicating back to the store |
| `src/server.ts` | Express API (`POST /api/trade-request`, `GET /health`) |
| `src/steam.ts` | Steam client, trade handler, rollback detection |
| `src/index.ts` | Entry point — wires everything together |

## Setup

### 1. Clone & install

```bash
git clone git@github.com:kvfs2k07/steam-paywall-backend.git
cd steam-paywall-backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

| Variable | Required | Description |
|---|---|---|
| `STEAM_REFRESH_TOKEN` | ✅ | Steam refresh token for the bot account |
| `API_URL` | ✅ | The store webhook endpoint |
| `SHARED_SECRET` | ✅ | 64-char hex HMAC secret shared with the store |
| `API_DEV_URL` | — | Dev webhook URL (used when `DEV=true`) |
| `STEAM_API_KEY` | — | Steam Web API key (auto-extracted from session if empty) |
| `MIN_ITEM_PRICE` | — | Minimum item value in USD to accept (default: `0.15`) |
| `PORT` | — | HTTP server port (default: `3000`) |
| `DEV` | — | Set `true` to point at `API_DEV_URL` |

### 3. Build & run

```bash
npm run build      # Compile TypeScript → dist/
npm start          # Run compiled output

# Development (hot reload)
npm run dev
```

### 4. Tests

```bash
npm test                # Run all tests once
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

## API & Integration

Full payload samples, responses, and curl commands are available in [examples/README.md](examples/README.md).

### `POST /api/trade-request`

Registers a pending trade request from the store.

**Headers:**
* `Authorization: Bearer <SHARED_SECRET>`
* `Content-Type: application/json`

**Mode A — Linked Steam Account (Recommended):**
When the buyer connected their Steam account on your store, pass their `steamId64`:
```json
{
  "id": "e4b1a8d0-25c7-4b91-88fc-430b2ad01f41",
  "steamId64": "76561198012345678"
}
```

**Mode B — Guest / Unlinked Checkout (Bearer Token in Trade Note):**
When the buyer does not want to connect their Steam account, omit `steamId64`:
```json
{
  "id": "f8c2e9b1-73a4-4c12-98ad-15e76b4a3902"
}
```
The buyer pastes this transaction ID into the Steam Trade Offer note. The bot matches the note and immediately evicts the token upon trade evaluation.

**Response:**
```json
{ "success": true, "message": "Trade request cached successfully" }
```

### `GET /health`

Liveness probe.

```json
{ "status": "ok", "pendingTrades": 3 }
```

## Rollback Detection

After accepting a trade, the bot starts 7-day monitoring. Every 15 minutes it:

1. Fetches the bot's current inventory
2. Checks if tracked item asset IDs are still present
3. If missing: queries Steam `IEconService/GetTradeHistory` (via API key **or** access token — bypasses the $5 account limit)
4. Falls back to scraping the Steam trade history page
5. If a rollback is confirmed (Steam status 5–12): notifies the store via `POST` webhook with `event: "trade_reversed"`

## License

Apache-2.0 — see [LICENSE](LICENSE).
