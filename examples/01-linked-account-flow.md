# Simulation: Linked Steam Account Flow

This scenario simulates a customer who connects their Steam account via Steam OpenID on the store website and pays with CS2/Rust skins.

---

### Step 1: Store Registers Pending Trade Request

When the buyer clicks "Pay with Skins", the store creates an internal order and registers it with the paywall engine.

#### HTTP Request to Paywall Engine
```http
POST /api/trade-request HTTP/1.1
Host: localhost:3000
Authorization: Bearer b466546ab1a970d1de97cc4b547647ba6c75e482a7be120f3f7267dbad9e524d
Content-Type: application/json

{
  "id": "order_7a9f1b2c-8e4d-4a11-b0e2-89c56f34e819",
  "steamId64": "76561198012345678"
}
```

#### Engine Response
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": true,
  "message": "Trade request cached successfully"
}
```

---

### Step 2: Customer Sends Steam Trade Offer

The customer sends a Steam trade offer directly to the bot's trade URL.
* **Partner SteamID64:** `76561198012345678`
* **Items Offered:**
  * AK-47 | Redline (Field-Tested) — Market Value: $18.50
  * USP-S | Cortex (Minimal Wear) — Market Value: $6.20
* **Trade Note:** *(Empty or arbitrary text — not required since SteamID64 is bound)*

---

### Step 3: Engine Matches Offer & Queries Store Webhook

The paywall engine detects the new offer, matches `76561198012345678` to `order_7a9f1b2c-...`, values the skins ($24.70 total), and asks the store to approve or decline.

#### Webhook Request from Engine to Store
```http
POST /api/payments/steamhook HTTP/1.1
Host: store.xyz
Authorization: Bearer b466546ab1a970d1de97cc4b547647ba6c75e482a7be120f3f7267dbad9e524d
Content-Type: application/json

{
  "transactionId": "order_7a9f1b2c-8e4d-4a11-b0e2-89c56f34e819",
  "amount": 24.70
}
```

#### Store Webhook Response (Accept)
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "accept": true
}
```

---

### Step 4: Engine Accepts Trade & Enrolls in Rollback Monitoring

1. The bot calls Steam's `acceptOfferAsync(offer)`.
2. The trade completes successfully on Steam.
3. The engine registers the two asset IDs into `tracked_trades.json` to monitor for 7-day Trade Protection reversals.
4. The transaction is removed from the pending cache (`cache.delete(tradeId)`).
