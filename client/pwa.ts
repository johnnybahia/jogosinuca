// Jogo offline + atualização dentro do jogo (mesmo esquema do Kage e do Rami-kami): o service worker guarda tudo na 1ª visita,
// uma versão nova espera o jogador tocar em "Atualizar" (nunca no meio de uma partida).
export interface PwaState {
  supported: boolean;
  phase: 'idle' | 'downloading' | 'ready';
  pct: number;
  update: boolean;
  installable: boolean;
  standalone: boolean;
}

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const standaloneNow = (): boolean => {
  try {
    return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
};

let state: PwaState = { supported: false, phase: 'idle', pct: 0, update: false, installable: false, standalone: standaloneNow() };
const listeners = new Set<(s: PwaState) => void>();
const set = (p: Partial<PwaState>): void => {
  state = { ...state, ...p };
  listeners.forEach((l) => l(state));
};

export const getPwa = (): PwaState => state;
export function onPwa(l: (s: PwaState) => void): () => void {
  listeners.add(l);
  l(state);
  return () => listeners.delete(l);
}

let deferred: InstallEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallEvent;
  set({ installable: true });
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  set({ installable: false, standalone: true });
});

export const isIos = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function installApp(): Promise<void> {
  if (!deferred) return;
  const ev = deferred;
  deferred = null;
  set({ installable: false });
  try {
    await ev.prompt();
    await ev.userChoice;
  } catch {
    /* recusou */
  }
}

/** Última saída: apaga service worker e cache e baixa tudo de novo (sempre pega a versão publicada). */
async function hardRefresh(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    for (const k of await caches.keys()) if (k.startsWith('sinuca-')) await caches.delete(k);
  } catch {
    /* segue para o reload */
  }
  location.reload();
}

/** Troca para a versão que está esperando e recarrega quando ela assumir. */
export async function applyUpdate(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    if (!reg?.waiting) {
      await reg?.update().catch(() => {});
      if (!reg?.waiting) return void (await hardRefresh());
    }
    let done = false;
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        done = true;
        location.reload();
      },
      { once: true },
    );
    reg!.waiting!.postMessage({ type: 'SKIP_WAITING' });
    window.setTimeout(() => {
      if (!done) void hardRefresh();
    }, 3000);
  } catch {
    void hardRefresh();
  }
}

/** Procura versão nova agora (botão "Atualizar"). Sem service worker, só dá para recarregar. */
export async function checkForUpdate(): Promise<'update' | 'none' | 'unsupported'> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return 'unsupported';
  try {
    const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    if (!reg) return 'unsupported';
    if (reg.waiting) return 'update';
    await reg.update().catch(() => {});
    if (reg.waiting) return 'update';
    const w = reg.installing;
    if (!w) return 'none';
    return await new Promise((resolve) => {
      const t = window.setTimeout(() => resolve('none'), 20000);
      w.addEventListener('statechange', () => {
        if (w.state === 'installed') {
          window.clearTimeout(t);
          resolve('update');
        } else if (w.state === 'redundant') {
          window.clearTimeout(t);
          resolve('none');
        }
      });
    });
  } catch {
    return 'none';
  }
}

/** Compara a versão publicada (version.json, sempre da rede) com a do service worker ativo: avisa mesmo se o navegador não detectou. */
async function checkRemote(reg: ServiceWorkerRegistration): Promise<void> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const remote = ((await r.json()) as { v?: string }).v;
    if (!remote || !reg.active) return;
    const mine = await new Promise<string | null>((resolve) => {
      const t = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener('message', h);
        resolve(null);
      }, 2500);
      const h = (e: MessageEvent): void => {
        const d = e.data as { type?: string; v?: string } | null;
        if (d?.type !== 'version') return;
        window.clearTimeout(t);
        navigator.serviceWorker.removeEventListener('message', h);
        resolve(d.v ?? null);
      };
      navigator.serviceWorker.addEventListener('message', h);
      reg.active!.postMessage({ type: 'VERSION' });
    });
    // sem resposta = service worker antigo (anterior a este aviso)
    if (mine !== remote) {
      set({ update: true });
      void reg.update().catch(() => {});
    }
  } catch {
    /* sem rede */
  }
}

function onMessage(e: MessageEvent): void {
  const d = e.data as { type?: string; done?: number; total?: number; fresh?: boolean; missing?: number } | null;
  if (!d?.type) return;
  if (d.type === 'progress' && d.fresh && d.total) {
    const pct = Math.round(((d.done ?? 0) / d.total) * 100);
    set(pct >= 100 ? { phase: 'ready', pct: 100 } : { phase: 'downloading', pct });
  } else if (d.type === 'status' && d.total) {
    set(d.missing ? { phase: 'downloading', pct: Math.round(((d.total - d.missing) / d.total) * 100) } : { phase: 'ready', pct: 100 });
  } else if (d.type === 'ready') {
    void navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).then((r) => r?.active?.postMessage({ type: 'STATUS' }));
  }
}

async function start(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
    set({ supported: true });
    navigator.serviceWorker.addEventListener('message', onMessage);
    const watch = (w: ServiceWorker | null): void => {
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) set({ update: true });
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) set({ update: true });
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    void navigator.serviceWorker.ready.then((r) => r.active?.postMessage({ type: 'STATUS' }));
    // app instalado fica aberto por muito tempo: procura versão nova ao voltar para a frente
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void reg.update().catch(() => {});
        void checkRemote(reg);
      }
    });
    setInterval(() => {
      void reg.update().catch(() => {});
      void checkRemote(reg);
    }, 10 * 60 * 1000);
    void navigator.serviceWorker.ready.then((r) => window.setTimeout(() => void checkRemote(r), 3000));
  } catch {
    /* sem service worker: o jogo só precisa da conexão */
  }
}

export function registerPwa(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const go = (): number => window.setTimeout(() => void start(), 2500);
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}
