/* Sinuca 3D service worker — gerado no build (vite.config.ts). Não edite sw.js direto.
 * - 1ª visita: baixa o jogo inteiro (4 downloads em paralelo) e avisa o progresso às abas.
 * - Cada arquivo tem hash de conteúdo: versão nova só baixa o que mudou.
 * - Versão nova NÃO assume sozinha: espera o jogador tocar em "Atualizar" (mensagem SKIP_WAITING).
 * - /api e /ws nunca passam por aqui (jogo online precisa de rede). */
const VERSION = '__VERSION__';
const BASE = '__BASE__';
const FILES = __FILES__; // [{ url, hash }]
const CACHE = `sinuca-${VERSION}`;
const PREFIX = 'sinuca-';

/** Resposta vinda de redirecionamento não pode ser usada em navegação: recria uma limpa. */
async function clean(res) {
  if (!res || !res.redirected) return res;
  return new Response(await res.blob(), { status: 200, statusText: 'OK', headers: res.headers });
}

const keyOf = (f) => `${BASE}${f.url}?v=${f.hash}`;

async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach((c) => c.postMessage(msg));
}

async function precache() {
  const cache = await caches.open(CACHE);
  // reaproveita o que já existe em versões antigas com o mesmo hash
  const olds = (await caches.keys()).filter((k) => k.startsWith(PREFIX) && k !== CACHE);
  const total = FILES.length;
  let done = 0;
  const queue = FILES.slice();
  const fresh = olds.length === 0;
  const worker = async () => {
    for (;;) {
      const f = queue.shift();
      if (!f) return;
      const key = keyOf(f);
      let hit = await cache.match(key);
      if (!hit) {
        for (const o of olds) {
          const oc = await caches.open(o);
          const m = await oc.match(key);
          if (m) {
            await cache.put(key, m.clone());
            hit = m;
            break;
          }
        }
      }
      if (!hit) {
        const res = await fetch(`${BASE}${f.url}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`falha ao baixar ${f.url}`);
        await cache.put(key, await clean(res));
      }
      done++;
      broadcast({ type: 'progress', done, total, fresh });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      await precache();
      // conserta quem ficou com uma versão antiga quebrada (index.html salvo como redirecionamento): assume já
      const shell = FILES.find((f) => f.url === 'index.html');
      for (const k of await caches.keys()) {
        if (!k.startsWith(PREFIX) || k === CACHE) continue;
        const oc = await caches.open(k);
        for (const r of await oc.matchAll()) if (r.redirected) return self.skipWaiting();
        if (shell && !(await oc.match(keyOf(shell)))) return self.skipWaiting();
      }
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      broadcast({ type: 'ready' });
    })(),
  );
});

self.addEventListener('message', async (e) => {
  const d = e.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  if (d.type === 'STATUS') {
    const cache = await caches.open(CACHE);
    let missing = 0;
    for (const f of FILES) if (!(await cache.match(keyOf(f)))) missing++;
    broadcast({ type: 'status', total: FILES.length, missing });
    if (missing) {
      try {
        await precache();
        broadcast({ type: 'status', total: FILES.length, missing: 0 });
      } catch (_) {
        /* sem rede: tenta na próxima */
      }
    }
  }
});

const byUrl = new Map(FILES.map((f) => [BASE + f.url, f]));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(`${BASE}api/`) || url.pathname.startsWith(`${BASE}ws/`) || url.pathname === `${BASE}sw.js`) return;

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') {
        const shell = FILES.find((f) => f.url === 'index.html');
        const hit = shell && (await cache.match(keyOf(shell)));
        if (hit) return clean(hit);
        return fetch(req);
      }
      const f = byUrl.get(url.pathname);
      if (f) {
        const hit = await cache.match(keyOf(f));
        if (hit) return clean(hit);
      }
      return fetch(req);
    })(),
  );
});
