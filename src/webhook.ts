// src/webhook.ts
// Apache-2.0 License — see LICENSE

import fetch from 'node-fetch';
import logger from './logger.js';
import type { Config, TrackedTrade, WebhookRequest, WebhookResponse } from './types.js';
import { getItemPrice } from './prices.js';

export async function notifyWebhookTradeReceived(
  config: Config,
  transactionId: string,
  amount: number,
): Promise<WebhookResponse> {
  const payload: WebhookRequest = { transactionId, amount };

  const response = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.sharedSecret}`,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`Webhook responded HTTP ${response.status} ${response.statusText}: ${rawText.slice(0, 300)}`);
  }

  try {
    return JSON.parse(rawText) as WebhookResponse;
  } catch {
    throw new Error(`Webhook returned non-JSON (HTTP ${response.status}): ${rawText.slice(0, 300)}`);
  }
}

export async function notifyWebhookReversal(
  config: Config,
  trade: TrackedTrade,
): Promise<void> {
  let tradeAmount = trade.amount;
  if (!tradeAmount && trade.items.length > 0) {
    tradeAmount = Number(
      trade.items
        .reduce((sum, it) => sum + getItemPrice(it.market_hash_name, it.appid), 0)
        .toFixed(2),
    );
  }

  const payload: WebhookRequest = {
    transactionId: trade.transactionId,
    amount: tradeAmount,
    status: 'reversed',
    event: 'trade_reversed',
    tradeId: trade.tradeId ?? null,
    offerId: trade.offerId ?? null,
    partnerSteamId64: trade.partnerSteamId64 ?? null,
    reason: 'Trade was rolled back via Steam Trade Protection (status 12)',
  };

  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.sharedSecret}`,
      },
      body: JSON.stringify(payload),
    });
    const rawText = await response.text();
    logger.info(
      `Webhook reversal notification sent for transaction ${trade.transactionId} (HTTP ${response.status}): ${rawText.slice(0, 150)}`,
    );
  } catch (err) {
    logger.error(
      `Failed to notify webhook of trade reversal for ${trade.transactionId}: ${(err as Error).message}`,
    );
  }
}
