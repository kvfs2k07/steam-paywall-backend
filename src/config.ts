// src/config.ts
// Apache-2.0 License — see LICENSE

import dotenv from 'dotenv';
import type { Config } from './types.js';

dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val.trim();
}

function optionalEnv(key: string): string | null {
  const val = process.env[key];
  return val && val.trim() !== '' ? val.trim() : null;
}

export function loadConfig(): Config {
  const isDev = process.env['DEV'] === 'true';
  const webhookUrl = isDev
    ? optionalEnv('API_DEV_URL')
    : optionalEnv('API_URL');

  if (!webhookUrl) {
    throw new Error('Missing required environment variable: API_URL (or API_DEV_URL when DEV=true)');
  }

  const sharedSecret = optionalEnv('SHARED_SECRET');
  if (!sharedSecret) {
    throw new Error('SHARED_SECRET is not set or is empty. Please fill it in your .env file.');
  }

  return {
    steamRefreshToken: requireEnv('STEAM_REFRESH_TOKEN'),
    steamApiKey: optionalEnv('STEAM_API_KEY'),
    webhookUrl,
    port: process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3000,
    sharedSecret,
    minItemPrice: process.env['MIN_ITEM_PRICE']
      ? parseFloat(process.env['MIN_ITEM_PRICE'])
      : 0.10,
  };
}
