# Simulation: Underpaid or Rejected Trade Flow

This scenario simulates a customer who registers a trade for a purchase, but sends items worth less than the required amount or low-tier junk items below `MIN_ITEM_PRICE`.

---

### Step 1: Store Registers Pending Trade Request

Store registers an order expecting $50.00 worth of CS2 skins.

```http
POST /api/trade-request HTTP/1.1
Host: localhost:3000
Authorization: Bearer b466546ab1a970d1de97cc4b547647ba6c75e482a7be120f3f7267dbad9e524d
Content-Type: application/json

{
  "id": "order_low_payment_991823",
  "steamId64": "76561198044332211"
}
```

---

### Step 2: Customer Sends Inadequate Items

Customer sends a trade offer containing:
* P250 | Sand Dune (Battle-Scarred) — Value: $0.04 *(Ignored: below `MIN_ITEM_PRICE=0.15` threshold)*
* Glock-18 | Water Elemental (Field-Tested) — Value: $8.50

Total calculated valid trade value: **$8.50**.

---

### Step 3: Engine Queries Store Webhook

The tradebot communicates the actual calculated total value ($8.50) to the store:

```http
POST /api/payments/steamhook HTTP/1.1
Host: store.xyz
Authorization: Bearer b466546ab1a970d1de97cc4b547647ba6c75e482a7be120f3f7267dbad9e524d
Content-Type: application/json

{
  "transactionId": "order_low_payment_991823",
  "amount": 8.50
}
```

---

### Step 4: Store Webhook Rejects Offer

The store detects that $8.50 is insufficient for a $50.00 order and instructs the engine to decline the trade:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "accept": false,
  "reason": "Offered skin value ($8.50) is below required order total ($50.00)"
}
```

---

### Step 5: Engine Cancels Steam Offer

1. The bot invokes `silentCancel(offer)` to decline the incoming trade offer without counter-offering.
2. The reason is logged in the engine logs.
3. The transaction is removed from the pending cache. No items are tracked.
