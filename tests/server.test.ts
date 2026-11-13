// tests/server.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';
import { TradeRequestCache } from '../src/cache.js';
import type { Config } from '../src/types.js';

// supertest is a dev-dependency; install separately: npm i -D supertest @types/supertest

const testConfig: Config = {
  steamRefreshToken: 'test-token',
  steamApiKey: null,
  webhookUrl: 'http://localhost:9999/api/payments/steamhook',
  port: 3001,
  sharedSecret: 'test-shared-secret-hex-64chars-aaaa',
  minItemPrice: 0.15,
};

function makeCache(): TradeRequestCache {
  const c = new TradeRequestCache(':memory:');
  vi.spyOn(c, 'persist').mockImplementation(() => {});
  return c;
}

describe('POST /api/trade-request', () => {
  let cache: TradeRequestCache;
  let app: ReturnType<typeof createServer>;

  beforeEach(() => {
    cache = makeCache();
    app = createServer(testConfig, cache);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).post('/api/trade-request').send({ id: 'tx-1' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header is wrong', async () => {
    const res = await request(app)
      .post('/api/trade-request')
      .set('Authorization', 'Bearer wrong-secret')
      .send({ id: 'tx-1' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when id is missing', async () => {
    const res = await request(app)
      .post('/api/trade-request')
      .set('Authorization', `Bearer ${testConfig.sharedSecret}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('caches a valid trade request and returns 200', async () => {
    const res = await request(app)
      .post('/api/trade-request')
      .set('Authorization', `Bearer ${testConfig.sharedSecret}`)
      .send({ id: 'tx-1', steamId64: '76561198012345678' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(cache.get('tx-1')?.steamId64).toBe('76561198012345678');
  });

  it('replaces a previous pending trade for the same SteamID64', async () => {
    await request(app)
      .post('/api/trade-request')
      .set('Authorization', `Bearer ${testConfig.sharedSecret}`)
      .send({ id: 'tx-old', steamId64: '76561198012345678' });

    await request(app)
      .post('/api/trade-request')
      .set('Authorization', `Bearer ${testConfig.sharedSecret}`)
      .send({ id: 'tx-new', steamId64: '76561198012345678' });

    expect(cache.has('tx-old')).toBe(false);
    expect(cache.has('tx-new')).toBe(true);
    expect(cache.size).toBe(1);
  });
});

describe('GET /health', () => {
  it('returns 200 with status ok and pendingTrades count', async () => {
    const cache = makeCache();
    const app = createServer(testConfig, cache);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.pendingTrades).toBe('number');
  });
});
