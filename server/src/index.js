/*
 * index.js — Worker entry point.
 *
 *   GET /health            -> {ok:true, version}   (CORS *)
 *   GET /ws/<CODE>?...     -> WebSocket, handed to the Room Durable Object for CODE
 *   anything else          -> 404
 *
 * Validation that does not need room state (code format, client version) is
 * done here so bad requests never wake a Durable Object. Errors on the
 * WebSocket route are reported *over* an accepted socket ({t:'error'} then
 * close), because browsers cannot read the body of a failed upgrade.
 */
import { Core } from './engine.js';
import { parseCode, errorFrame } from './protocol.js';

export { Room } from './room.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });
}

/** Accept a WebSocket only to tell the client why it is rejected, then close it. */
function rejectSocket(code, msg) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send(errorFrame(code, msg));
  server.close(4000, code);
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, version: Core.VERSION ?? null });
    }

    const match = url.pathname.match(/^\/ws\/([^/]*)\/?$/);
    if (!match || request.method !== 'GET') return json({ ok: false, error: 'not found' }, 404);

    // Any Origin is allowed (GitHub Pages, claude.ai, local files), so no Origin check.
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return json({ ok: false, error: 'expected a WebSocket upgrade' }, 426);
    }

    let rawCode = '';
    try { rawCode = decodeURIComponent(match[1]); } catch { /* malformed escape -> badcode */ }
    const code = parseCode(rawCode);
    if (!code) return rejectSocket('badcode', 'That farm code is not valid.');

    // The client must run the same engine build as the server.
    const version = Core.VERSION == null ? null : String(Core.VERSION);
    if (version !== null && url.searchParams.get('v') !== version) {
      return rejectSocket('version', `Game updated (server ${version}). Please reload the page.`);
    }

    // Normalised code goes to the Room via a header so it never re-parses the path.
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const headers = new Headers(request.headers);
    headers.set('X-Room-Code', code);
    return stub.fetch(new Request(request.url, { method: 'GET', headers }));
  },
};
