import './style.css';
import { LocalBackend } from './local';
import { GameScreen } from './ui/gameScreen';
import { btn, h, toast } from './ui/dom';
import { showMenu, showProfile } from './ui/screens';
import { PoolView } from './game/view';
import { registerPwa } from './pwa';
import { applyPrefsToPage, loadPrefs, loadProfile, type OfflineSettings, type Profile } from './store';

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
const m0 = (await import('../shared/rules')).newMatch('par_impar');
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
    });
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
    } as Parameters<typeof showMenu>[1],
    () => showProfile(root, profile, (p) => { profile = p; menu(); }, () => menu()),
  );
}

function startOffline(cfg: OfflineSettings): void {
  if (!profile) return;
  stopMenu?.();
  stopMenu = null;
  new GameScreen({
    view,
    backend: new LocalBackend(profile, cfg),
    profile,
    root,
    onExit: () => menu(),
  });
}

menu();
(window as unknown as { done: boolean }).done = true;
void toast;
