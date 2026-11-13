// src/server.ts
// Apache-2.0 License — see LICENSE

import express, { type Request, type Response } from 'express';
import logger from './logger.js';
import type { Config } from './types.js';
import type { TradeRequestCache } from './cache.js';

export function createServer(config: Config, cache: TradeRequestCache): express.Application {
  const app = express();
  app.use(express.json());

  /** POST /api/trade-request — called by the store to register a pending trade */
  app.post('/api/trade-request', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${config.sharedSecret}`) {
      logger.warn(`Unauthorized API request from ${req.ip}`);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, steamId, steamId64, senderSteamId } = req.body as Record<string, unknown>;

    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: "Missing required 'id' field" });
      return;
    }

    const targetSteamId64 =
      ((steamId64 ?? steamId ?? senderSteamId ?? '') as string).toString().trim() || null;

    cache.upsert(id, targetSteamId64);
    cache.persist();

    logger.info(
      `New trade request cached: ID=${id}${targetSteamId64 ? ` (SteamID64=${targetSteamId64})` : ' (no SteamID64 — will match by note)'}`,
    );

    res.json({ success: true, message: 'Trade request cached successfully' });
  });

  /** GET /health — liveness probe */
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', pendingTrades: cache.size });
  });

  return app;
}
