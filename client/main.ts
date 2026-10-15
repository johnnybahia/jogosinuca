import './style.css';
import { LocalBackend } from './local';
import { OnlineBackend } from './net/online';
import { claimName, createRoom, getRanking, listRooms } from './api';
import { GameScreen } from './ui/gameScreen';
import { btn, h, toast } from './ui/dom';
import { showMenu, showProfile } from './ui/screens';
import { PoolView } from './game/view';
import { registerPwa } from './pwa';
import { newMatch } from '../shared/rules';
import { applyPrefsToPage, loadOfflineSettings, loadPrefs, loadProfile, type OfflineSettings, type Profile } from './store';

registerPwa();
applyPrefsToPage();
const root = document.getElementById('app')!;
const canvas = document.getElementById('gl') as HTMLCanvasElement;

const loading = h('div', { class: 'loading' }, h('div', { class: 'loading-in' }, h('div', { class: 'logo' }, h('div', { class: 'logo-text' }, h('div', { class: 'logo-t1', text: 'SINUCA' }), h('div', { class: 'logo-t2', text: '3D · BRASILEIRA' }))), h('div', { class: 'bar' }, h('i')), h('div', { class: 'loading-msg', text: 'Montando a mesa…' })));
document.body.append(loading);
const bar = loading.querySelector('i') as HTMLElement;
const msg = loading.querySelector('.loading-msg') as HTMLElement;

let view: PoolView;
try {
  view = await PoolView.create(canvas, loadPrefs().quality, (p) => (bar.style.width = `${Math.round(p * 100)}%`));
} catch (e) {
  console.error(e);
  msg.textContent = 'Seu navegador não conseguiu iniciar o 3D (WebGL). Tente atualizar o navegador.';
  loading.append(btn('Tentar de novo', () => location.reload(), 'primary'));
  throw e;
}
view.setFelt(loadPrefs().felt);
view.onSlow = (q) => {
  if (loadPrefs().quality !== 'auto') return;
  view.setLevel(q);
  toast(q === 'low' ? 'Gráficos reduzidos para manter a fluidez.' : 'Gráficos ajustados para o seu aparelho.');
};
const m0 = newMatch('par_impar');
view.setBalls(m0.balls);
view.setAim(null);
view.setCameraMode('menu');
view.cam.snap();
view.start();
window.addEventListener('resize', () => view.resize());
loading.classList.add('out');
setTimeout(() => loading.remove(), 800);
(window as unknown as { __view: PoolView; done: boolean }).__view = view;

let profile: Profile | null = loadProfile();
let stopMenu: (() => void) | null = null;

function menu(): void {
  stopMenu?.();
  stopMenu = null;
  view.setBalls(m0.balls);
  view.setAim(null);
  view.setCameraMode('menu');
  if (!profile) {
    showProfile(root, null, (p) => {
      profile = p;
      menu();
    }, undefined, claimName);
    return;
  }
  stopMenu = showMenu(
    root,
    {
      profile,
      onProfile: () => {},
      startOffline,
      setQuality: (q) => view.setQuality(q),
      setFelt: (id) => view.setFelt(id),
      online: {
        create: async (isPublic) => {
          if (!navigator.onLine) return void toast('Sem internet: use o modo offline.');
          try {
            const cfg = loadOfflineSettings();
            const { code } = await createRoom({ mode: cfg.mode, turnSeconds: cfg.turnSeconds || 60, isPublic, bestOf: 1 });
            startOnline(code);
          } catch {
            toast('Não consegui criar a sala. Confira a conexão.');
          }
        },
        join: (code) => startOnline(code),
        publicRooms: () => listRooms(),
        ranking: () => getRanking(),
      },
    } as Parameters<typeof showMenu>[1],
    () => showProfile(root, profile, (p) => { profile = p; menu(); }, () => menu(), claimName),
  );
}

function startOffline(cfg: OfflineSettings, practice = false): void {
  if (!profile) return;
  stopMenu?.();
  stopMenu = null;
  new GameScreen({
    view,
    backend: new LocalBackend(profile, cfg, practice),
    profile,
    root,
    onExit: () => menu(),
  });
}

function startOnline(code: string): void {
  if (!profile) return;
  if (!navigator.onLine) return void toast('Sem internet: use o modo offline.');
  const p = profile;
  stopMenu?.();
  stopMenu = null;
  history.replaceState(null, '', `${location.pathname}?sala=${code}`);
  new GameScreen({
    view,
    backend: new OnlineBackend(code, p),
    profile: p,
    root,
    onExit: () => {
      history.replaceState(null, '', location.pathname);
      menu();
    },
  });
}

menu();
// link de convite: ?sala=ABCDE
const invite = new URLSearchParams(location.search).get('sala')?.toUpperCase();
if (invite && /^[A-Z0-9]{5}$/.test(invite) && profile) startOnline(invite);
(window as unknown as { done: boolean }).done = true;
