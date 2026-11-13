# Simulation: Guest Checkout Flow (Trade Note Bearer Token)

This scenario simulates a customer who chooses **guest checkout** (does not link their Steam account to the website). The transaction UUID acts as a one-time bearer token included in the Steam trade offer note.

---

### Step 1: Store Registers Unbound Trade Request

The store generates a cryptographically random UUID (`UUIDv4`) for the order and registers it with the engine without a `steamId64`.

#### HTTP Request to Paywall Engine
```http
POST /api/trade-request HTTP/1.1
Host: localhost:3000
Authorization: Bearer b466546ab1a970d1de97cc4b547647ba6c75e482a7be120f3f7267dbad9e524d
Content-Type: application/json

{
  "id": "e5c6a1b2-9384-4e2a-89f1-3d7c5b1a8f90"
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

### Step 2: Store Displays Instructions to Customer

The website checkout page provides the customer with:
1. The bot's Steam Trade Offer URL.
2. The exact reference code to paste into the Trade Offer note:  
   `e5c6a1b2-9384-4e2a-89f1-3d7c5b1a8f90`

---

### Step 3: Customer Sends Steam Trade Offer

The customer sends a Steam trade offer:
* **Partner SteamID64:** `76561198099887766` *(unknown to store)*
* **Items Offered:** AWP | Atheris (Field-Tested) ($12.50)
* **Trade Note / Message:**
  ```text
  e5c6a1b2-9384-4e2a-89f1-3d7c5b1a8f90
  ```

---

### Step 4: Engine Matches Offer via Note & Calls Webhook

1. Strategy 1 (SteamID64) finds no match.
2. Strategy 2 (Exact Note Match) finds `cache.has('e5c6a1b2-9384-4e2a-89f1-3d7c5b1a8f90')`.
3. Because `data.steamId64` is null, the engine treats the valid UUID note as the bearer authorization token.
4. Total item value ($12.50) is calculated and submitted to the store webhook.

#### Webhook Request to Store
```http
POST /api/payments/steamhook HTTP/1.1
Host: store.xyz
Authorization: Bearer b466546ab1a970d1de97cc4b547647ba6c75e482a7be120f3f7267dbad9e524d
Content-Type: application/json

{
  "transactionId": "e5c6a1b2-9384-4e2a-89f1-3d7c5b1a8f90",
  "amount": 12.50
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

### Step 5: Acceptance & Token Eviction

1. Trade is accepted on Steam.
2. The transaction ID is immediately deleted from memory (`cache.delete(tradeId)`), ensuring the bearer token can never be claimed again.
3. Item is enrolled in 7-day rollback tracking.
