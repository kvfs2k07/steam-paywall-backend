# API & Webhook Request Documentation & Examples

This directory provides request and response schemas, payloads, and `curl` examples for integrating your store website with the Steam Tradebot.

---

## 1. Register Pending Trade (`POST /api/trade-request`)

Sent by the store backend to the bot whenever a customer initiates a skin payment checkout.

### Endpoint
* **URL:** `http://localhost:3000/api/trade-request` (or your configured port/host)
* **Method:** `POST`
* **Headers:**
  * `Content-Type: application/json`
  * `Authorization: Bearer <SHARED_SECRET>`

### Modes

#### Mode A: Linked Steam Account (Recommended)
When the customer connects their Steam account via Steam OpenID on your store:
* The store supplies the buyer's 64-bit Steam ID (`steamId64`, `steamId`, or `senderSteamId`).
* The tradebot automatically matches incoming Steam trade offers from this `steamId64` without requiring the buyer to type anything into the trade note.

**Payload (`examples/trade-request-linked.json`):**
```json
{
  "id": "e4b1a8d0-25c7-4b91-88fc-430b2ad01f41",
  "steamId64": "76561198012345678"
}
```

**Curl:**
```bash
curl -X POST http://localhost:3000/api/trade-request \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer replace-with-64-char-hex-secret" \
  -d @examples/trade-request-linked.json
```

#### Mode B: Guest / Unlinked Checkout (Bearer Token Note Fallback)
When the customer prefers not to link their Steam account for privacy:
* The store registers the transaction with only the unguessable `id` (e.g. UUIDv4).
* The customer is instructed on the store payment page to enter this transaction ID into the Steam Trade Offer message/note when sending skins to the bot.
* The bot matches the trade by checking the trade note, immediately evicting the token upon receipt.

**Payload (`examples/trade-request-guest.json`):**
```json
{
  "id": "f8c2e9b1-73a4-4c12-98ad-15e76b4a3902"
}
```

**Curl:**
```bash
curl -X POST http://localhost:3000/api/trade-request \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer replace-with-64-char-hex-secret" \
  -d @examples/trade-request-guest.json
```

### Response
* **Success (200 OK):**
  ```json
  {
    "success": true,
    "message": "Trade request cached successfully"
  }
  ```
* **Unauthorized (401):**
  ```json
  {
    "error": "Unauthorized"
  }
  ```
* **Bad Request (400):**
  ```json
  {
    "error": "Missing required 'id' field"
  }
  ```

---

## 2. Webhook: Trade Received (`POST <API_URL>`)

Sent by the tradebot to the store webhook endpoint when an incoming Steam trade offer matching a pending transaction is received.

### Request Sent by Tradebot
* **Headers:**
  * `Content-Type: application/json`
  * `Authorization: Bearer <SHARED_SECRET>`
* **Payload (`examples/webhook-trade-received-request.json`):**
  ```json
  {
    "transactionId": "e4b1a8d0-25c7-4b91-88fc-430b2ad01f41",
    "amount": 24.50
  }
  ```
  *(Note: `amount` represents the total calculated market value in USD of all qualifying items above `MIN_ITEM_PRICE`.)*

### Response Expected from Store
The bot pauses the trade until your store responds:

* **To Accept Offer (`examples/webhook-trade-received-response-accept.json`):**
  ```json
  {
    "accept": true
  }
  ```
  The bot immediately accepts the Steam trade offer and registers items for 7-day rollback monitoring.

* **To Reject / Cancel Offer (`examples/webhook-trade-received-response-reject.json`):**
  ```json
  {
    "accept": false,
    "reason": "Total trade offer value ($24.50) is below required order total ($30.00)"
  }
  ```
  The bot declines/cancels the incoming trade offer.

---

## 3. Webhook: Trade Reversal Notification (`POST <API_URL>`)

Sent by the tradebot if a previously accepted trade is rolled back by Steam Trade Protection within the 7-day window (Steam status 5–12).

### Request Sent by Tradebot
* **Headers:**
  * `Content-Type: application/json`
  * `Authorization: Bearer <SHARED_SECRET>`
* **Payload (`examples/webhook-trade-reversed.json`):**
  ```json
  {
    "transactionId": "e4b1a8d0-25c7-4b91-88fc-430b2ad01f41",
    "amount": 24.50,
    "status": "reversed",
    "event": "trade_reversed",
    "tradeId": "582910394812",
    "offerId": "7392019481",
    "partnerSteamId64": "76561198012345678",
    "reason": "Trade was rolled back via Steam Trade Protection (status 12)"
  }
  ```
The store backend should handle this event by revoking or freezing the corresponding customer order or credit.

---

## 4. Health Check (`GET /health`)

Simple liveness probe for monitoring systems (Kubernetes, Docker healthcheck, Uptime Kuma).

```bash
curl http://localhost:3000/health
```

**Response (200 OK):**
```json
{
  "status": "ok",
  "pendingTrades": 3
}
```
