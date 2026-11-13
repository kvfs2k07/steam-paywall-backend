// src/index.ts
// Apache-2.0 License — see LICENSE

import fs from 'fs';
import { loadConfig } from './config.js';
import logger from './logger.js';
import { loadPriceCache } from './prices.js';
import { TradeRequestCache } from './cache.js';
import { TradeTracker } from './tracking.js';
import { createServer } from './server.js';
import { createSteamBot } from './steam.js';

async function main(): Promise<void> {
  // Ensure logs directory exists
  if (!fs.existsSync('logs')) fs.mkdirSync('logs');

  // Load and validate configuration (throws on missing required vars)
  const config = loadConfig();

  // Initialise persistent stores
  const cache = new TradeRequestCache();
  cache.load();

  const tracker = new TradeTracker();
  tracker.load();

  // Warm up price caches (CS + Rust) in parallel
  await loadPriceCache();

  // Refresh price caches every hour
  setInterval(() => void loadPriceCache(), 60 * 60 * 1000);

  // Start Express API
  const app = createServer(config, cache);
  app.listen(config.port, () => {
    logger.info(`API server listening on port ${config.port}`);
  });

  // Start Steam bot + rollback tracking
  createSteamBot(config, cache, tracker);
}

main().catch((err: unknown) => {
  // Errors from loadConfig (missing env vars) land here before logger is ready
  console.error(`Fatal startup error: ${(err as Error).message}`);
  process.exit(1);
});
