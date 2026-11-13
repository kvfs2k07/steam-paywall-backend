# Simulation: Steam Trade Protection Rollback Flow

This scenario simulates a trade that was accepted, but the sender subsequently triggers a **Steam Trade Protection rollback** (e.g. self-locking their account or contacting Steam Support within the 7-day window).

---

### Initial State: Trade Accepted & Tracked

* **Transaction ID:** `order_7a9f1b2c-8e4d-4a11-b0e2-89c56f34e819`
* **Steam Trade Offer ID:** `7392019481`
* **Steam Trade ID:** `582910394812`
* **Sender SteamID64:** `76561198012345678`
* **Tracked Asset IDs:** `39182049182`, `39182049183`
* **Accepted Value:** $24.70

---

### Detection: 15-Minute Background Rollback Check

1. The bot's scheduled monitoring loop executes:
   ```ts
   // Checks bot's live inventory against asset IDs in tracked_trades.json
   ```
2. Asset IDs `39182049182` and `39182049183` are missing from the bot's inventory.
3. The engine queries the Steam Web API `IEconService/GetTradeHistory`:
   ```json
   {
     "tradeid": "582910394812",
     "status": 12
   }
   ```
   *Status 12 confirmed: Trade reversed / rolled back by Steam.*

---

### Step: Paywall Engine Notifies Store via Webhook

The paywall engine automatically sends a signed POST webhook to the store with `event: "trade_reversed"`.

#### HTTP Webhook Request to Store
```http
POST /api/payments/steamhook HTTP/1.1
Host: store.xyz
Authorization: Bearer b466546ab1a970d1de97cc4b547647ba6c75e482a7be120f3f7267dbad9e524d
Content-Type: application/json

{
  "transactionId": "order_7a9f1b2c-8e4d-4a11-b0e2-89c56f34e819",
  "amount": 24.70,
  "status": "reversed",
  "event": "trade_reversed",
  "tradeId": "582910394812",
  "offerId": "7392019481",
  "partnerSteamId64": "76561198012345678",
  "reason": "Trade was rolled back via Steam Trade Protection (status 12)"
}
```

---

### Step: Store Action

Upon receiving `event: "trade_reversed"`, the store:
1. Revokes the purchased digital product or license key.
2. Deducts the corresponding user wallet balance or bans the account for fraud.
3. Responds with `200 OK`.
