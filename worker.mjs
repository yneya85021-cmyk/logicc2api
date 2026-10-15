import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { timingSafeEqual } from 'node:crypto';
import { createAdapter } from './server.mjs';

const assetPaths = new Set(['/', '/index.html', '/app.js', '/style.css', '/favicon.svg']);
const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
const error = (status, message, headers = {}) => Response.json({ error: { message } }, { status, headers: { ...securityHeaders, ...headers } });
function equal(actual, expected) {
  const a = Buffer.from(actual || ''), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      url.protocol = 'https:';
      return Response.redirect(url.href, 308);
    }
    // A template deployment must never expose the account pool without secrets.
    if (!env.LOGICC_ADMIN_PASSWORD?.trim() || !env.LOGICC_API_KEY?.trim()) {
      return error(503, 'Configure LOGICC_ADMIN_PASSWORD and LOGICC_API_KEY in Worker secrets.');
    }
    const origin = request.headers.get('Origin');
    if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
      return error(403, 'Cross-origin requests are not allowed.');
    }
    // The local browser-to-localhost token bridge is intentionally unavailable online.
    if (url.pathname === '/__set_token') return error(404, 'Use the authenticated account management console.');
    if (url.pathname === '/health' && request.method === 'GET') return Response.json({ status: 'ok' }, { headers: securityHeaders });
    if (!url.pathname.startsWith('/v1/')) {
      const expected = 'Basic ' + Buffer.from(`admin:${env.LOGICC_ADMIN_PASSWORD}`).toString('base64');
      if (!equal(request.headers.get('Authorization'), expected)) {
        return error(401, 'Sign in with username admin and your console password.', { 'WWW-Authenticate': 'Basic realm="logicc2api", charset="UTF-8"' });
      }
    }
    if (assetPaths.has(url.pathname) && ['GET', 'HEAD'].includes(request.method)) {
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      for (const [key, value] of Object.entries(securityHeaders)) response.headers.set(key, value);
      return response;
    }
    return env.LOGICC.getByName('account-pool').fetch(request);
  },
};

export class LogiccService extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS documents (name TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (name, part))');
    const store = {
      get(name) {
        const rows = sql.exec('SELECT value FROM documents WHERE name = ? ORDER BY part', name).toArray();
        return rows.length ? JSON.parse(rows.map(row => row.value).join('')) : undefined;
      },
      put(name, data) {
        const text = JSON.stringify(data);
        // Chunk large account/prompt snapshots below SQLite's per-row size limit.
        ctx.storage.transactionSync(() => {
          sql.exec('DELETE FROM documents WHERE name = ?', name);
          for (let offset = 0, part = 0; offset < text.length; part++) {
            let end = Math.min(offset + 65536, text.length);
            const last = text.charCodeAt(end - 1);
            if (end < text.length && last >= 0xD800 && last <= 0xDBFF) end--; // Keep Unicode surrogate pairs together.
            sql.exec('INSERT INTO documents (name, part, value) VALUES (?, ?, ?)', name, part, text.slice(offset, end));
            offset = end;
          }
        });
      },
    };
    const { server } = createAdapter({
      dataFile: '/tmp/logicc/state.json', store,
      env: { LOGICC_API_KEY: env.LOGICC_API_KEY, LOGICC_API_BASE: env.LOGICC_API_BASE, LOGICC_CLERK_BASE: env.LOGICC_CLERK_BASE },
    });
    this.handler = httpServerHandler(server);
    this.server = server;
  }

  async fetch(request) {
    const publicUrl = new URL(request.url);
    const localOrigin = `http://127.0.0.1:${this.server.address().port}`;
    const localUrl = new URL(publicUrl.pathname + publicUrl.search, localOrigin);
    const headers = new Headers(request.headers);
    headers.set('Host', localUrl.host);
    // The public handler validated the real Origin before entering this private object.
    if (headers.has('Origin')) headers.set('Origin', localOrigin);
    const response = await this.handler.fetch(new Request(localUrl, { method: request.method, headers, body: request.body, signal: request.signal, redirect: 'manual' }));
    if (publicUrl.pathname === '/api/state' && response.ok) {
      const state = await response.json();
      state.service.baseUrl = `${publicUrl.origin}/v1`;
      state.service.runtime = 'cloudflare';
      const headers = new Headers(response.headers);
      headers.delete('Content-Length');
      return Response.json(state, { headers });
    }
    return response;
  }
}
