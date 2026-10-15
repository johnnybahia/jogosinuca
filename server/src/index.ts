import type { Env } from './env';
import { BEST_OF_OPTIONS, TURN_SECONDS_OPTIONS } from '../../shared/protocol';
import { MODES } from '../../shared/rules';

export { GameRoom } from './room';
export { Lobby } from './lobby';
export { Ranking } from './ranking';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = (): string => Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};
const json = (data: unknown, status = 200): Response => Response.json(data, { status, headers: cors });

/** Compara a chave de administrador sem parar no primeiro caractere diferente. */
const isAdmin = (req: Request, env: Env): boolean => {
  const key = req.headers.get('X-Admin-Key') ?? '';
  const want = env.ADMIN_KEY ?? '';
  if (!want || key.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= key.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const ranking = (): DurableObjectStub => env.RANKING.get(env.RANKING.idFromName('global'));

    if (url.pathname.startsWith('/ws/')) {
      const code = url.pathname.slice(4).toUpperCase();
      if (!/^[A-Z0-9]{5}$/.test(code)) return new Response('bad code', { status: 400 });
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(req);
    }

    if (url.pathname === '/api/ping') return json({ ok: true, t: Date.now() });

    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { turnSeconds?: number; isPublic?: boolean; mode?: string; bestOf?: number };
      const turnSeconds = typeof body.turnSeconds === 'number' && (TURN_SECONDS_OPTIONS as readonly number[]).includes(body.turnSeconds) ? body.turnSeconds : 60;
      const mode = MODES.some((m) => m.id === body.mode) ? body.mode : 'par_impar';
      const bestOf = typeof body.bestOf === 'number' && (BEST_OF_OPTIONS as readonly number[]).includes(body.bestOf) ? body.bestOf : 1;
      for (let i = 0; i < 8; i++) {
        const code = newCode();
        const r = await env.ROOM.get(env.ROOM.idFromName(code)).fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, turnSeconds, mode, bestOf, isPublic: !!body.isPublic }) });
        if (r.ok) return json({ code });
      }
      return json({ error: 'não foi possível criar a sala' }, 503);
    }

    if (url.pathname === '/api/rooms' && req.method === 'GET') {
      const r = await env.LOBBY.get(env.LOBBY.idFromName('global')).fetch('https://lobby/list');
      return json(await r.json());
    }

    if (url.pathname === '/api/ranking' && req.method === 'GET') {
      const r = await ranking().fetch('https://ranking/top?limit=50');
      return json(await r.json());
    }

    if (url.pathname === '/api/name/claim' && req.method === 'POST') {
      const r = await ranking().fetch('https://ranking/claim', { method: 'POST', body: await req.text() });
      return json(await r.json(), r.status);
    }

    // liberar um nome reservado: curl -X POST -H "X-Admin-Key: <senha>" -d '{"name":"Fulano"}' https://SEU-SITE/api/name/release
    if (url.pathname === '/api/name/release' && req.method === 'POST') {
      if (!isAdmin(req, env)) return json({ error: 'não autorizado' }, 401);
      await ranking().fetch('https://ranking/release', { method: 'POST', body: await req.text() });
      return json({ ok: true });
    }

    // zerar o ranking: curl -X POST -H "X-Admin-Key: <senha>" https://SEU-SITE/api/ranking/reset
    if (url.pathname === '/api/ranking/reset' && req.method === 'POST') {
      if (!isAdmin(req, env)) return json({ error: 'não autorizado' }, 401);
      await ranking().fetch('https://ranking/reset', { method: 'POST' });
      return json({ ok: true });
    }

    // erros do servidor: curl -H "X-Admin-Key: <senha>" https://SEU-SITE/api/errors
    if (url.pathname === '/api/errors' && req.method === 'GET') {
      if (!isAdmin(req, env)) return json({ error: 'não autorizado' }, 401);
      const r = await ranking().fetch('https://ranking/errors');
      return Response.json(await r.json(), { headers: { ...cors, 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/api/errors/clear' && req.method === 'POST') {
      if (!isAdmin(req, env)) return json({ error: 'não autorizado' }, 401);
      await ranking().fetch('https://ranking/errorsclear', { method: 'POST' });
      return json({ ok: true });
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
