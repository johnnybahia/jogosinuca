import { BOT_LABEL, BOT_LEVELS, BOT_NAMES, type BotLevel } from '../../shared/bot';
import { NAME_MAX, TURN_SECONDS_OPTIONS, turnLabel, type TurnSeconds } from '../../shared/protocol';
import { MODES, type Mode } from '../../shared/rules';
import { applyUpdate, installApp, isIos, onPwa } from '../pwa';
import { avatarColor, loadOfflineSettings, loadPrefs, loadStats, newId, photoFromFile, saveOfflineSettings, savePrefs, saveProfile, type OfflineSettings, type Profile } from '../store';
import { avatarEl, btn, clear, h, modal, segmented, toast } from './dom';
import { FELTS } from '../game/tableView';
import { getVolume, setVolume, sndClick } from '../game/audio';
import { qualityOptions } from './settings';

export interface MenuActions {
  profile: Profile;
  onProfile(p: Profile): void;
  startOffline(cfg: OfflineSettings, practice?: boolean): void;
  setQuality(q: ReturnType<typeof loadPrefs>['quality']): void;
  setFelt(id: string): void;
  /** só online */
  online?: OnlineMenu;
}

export interface OnlineMenu {
  create(isPublic: boolean): Promise<void>;
  join(code: string): void;
  publicRooms(): Promise<{ code: string; hostName: string; count: number; mode: Mode; turnSeconds: number }[]>;
  ranking(): Promise<{ id: string; name: string; games: number; wins: number; points: number }[]>;
}

const logo = (): HTMLElement =>
  h('div', { class: 'logo' }, h('div', { class: 'logo-ball', text: '8' }), h('div', { class: 'logo-text' }, h('div', { class: 'logo-t1', text: 'SINUCA' }), h('div', { class: 'logo-t2', text: '3D · BRASILEIRA' })));

// ---------- perfil ----------
export function showProfile(root: HTMLElement, existing: Profile | null, onDone: (p: Profile) => void, onCancel?: () => void, claim?: (id: string, name: string) => Promise<boolean>): void {
  clear(root);
  let photo = existing?.photo ?? null;
  const id = existing?.id ?? newId();
  const nameIn = h('input', { class: 'input', attrs: { type: 'text', maxlength: String(NAME_MAX), placeholder: 'Seu nome', autocomplete: 'nickname' } });
  nameIn.value = existing?.name ?? '';
  const preview = h('div', { class: 'photo-preview' });
  const drawPreview = (): void => {
    clear(preview);
    preview.append(avatarEl(nameIn.value || '?', avatarColor(id), photo, 'avatar big'));
  };
  drawPreview();
  nameIn.addEventListener('input', () => !photo && drawPreview());
  const pick = (capture: boolean): void => {
    const f = h('input', { attrs: { type: 'file', accept: 'image/*', ...(capture ? { capture: 'user' } : {}) } });
    f.addEventListener('change', async () => {
      const file = f.files?.[0];
      if (!file) return;
      try {
        photo = await photoFromFile(file);
        drawPreview();
      } catch {
        toast('Não consegui ler essa imagem.');
      }
    });
    f.click();
  };
  let saving = false;
  const save = async (): Promise<void> => {
    const name = nameIn.value.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return toast('Digite um nome com pelo menos 2 letras.');
    if (saving) return;
    saving = true;
    const free = claim ? await claim(id, name) : true;
    saving = false;
    if (!free) return toast('Esse nome já está em uso por outro jogador. Escolha outro.');
    const p: Profile = { id, name, photo };
    saveProfile(p);
    onDone(p);
  };
  nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && void save());
  root.append(
    h(
      'div',
      { class: 'screen center' },
      h(
        'div',
        { class: 'panel profile' },
        logo(),
        h('h2', { text: existing ? 'Seu perfil' : 'Bem-vindo à mesa' }),
        h('p', { class: 'muted', text: existing ? 'Nome e foto aparecem para quem joga com você.' : 'Como você quer ser chamado? O nome fica salvo neste aparelho.' }),
        preview,
        h('div', { class: 'row' }, btn('Escolher foto', () => pick(false), 'small'), btn('Selfie', () => pick(true), 'small'), photo || existing?.photo ? btn('Remover', () => { photo = null; drawPreview(); }, 'ghost small') : null),
        nameIn,
        h('div', { class: 'row' }, btn('Salvar e continuar', () => void save(), 'primary'), existing && onCancel ? btn('Cancelar', onCancel, 'ghost') : null),
      ),
    ),
  );
  nameIn.focus();
}

// ---------- como jogar ----------
function showHelp(): void {
  const box = h(
    'div',
    { class: 'panel help' },
    h('h2', { text: 'Como jogar' }),
    h('h3', { text: 'Controles' }),
    h('ul', null,
      h('li', { text: 'Arraste na mesa para girar a mira. Pinça ou roda do mouse dão zoom; dois dedos inclinam a câmera.' }),
      h('li', { text: 'Barra FORÇA (direita): puxe para baixo e solte para tacar. No teclado: segure Espaço e solte.' }),
      h('li', { text: 'EFEITO (esquerda): toque na bola branca para dar efeito — em cima (segue), embaixo (recua), nos lados. Toque duas vezes para centralizar.' }),
      h('li', { text: 'Barra "ajuste fino" (embaixo) para acertar o ângulo devagar. Setas ← → fazem o mesmo (Shift = ainda mais fino).' }),
      h('li', { text: 'V alterna a vista de cima (nela, toque onde quer mirar). G liga/desliga a linha de mira. H (💡) mostra a dica de tacada — só offline.' }),
      h('li', { text: 'Online: 💬 manda uma reação, 📷 e 🎤 ligam câmera e microfone (começam desligados).' }),
    ),
    h('h3', { text: 'Modos' }),
    h('ul', null, ...MODES.map((m) => h('li', null, h('b', { text: `${m.name}: ` }), m.desc))),
    h('h3', { text: 'Falta' }),
    h('p', { class: 'muted', text: 'Branca na caçapa, não tocar em nenhuma bola ou tocar primeiro na bola errada. Quem sofre a falta joga com a branca na mão (coloca onde quiser). Na Guerra, tocar primeiro numa bola sua é falta e bola sua na caçapa (fogo amigo) fica contra você; quem ficar sem bolas perde.' }),
    btn('Entendi', () => m.close(), 'primary'),
  );
  const m = modal(box);
}

// ---------- configurações ----------
export function showSettings(a: { setQuality(q: ReturnType<typeof loadPrefs>['quality']): void; setFelt(id: string): void }): void {
  const p = loadPrefs();
  const vol = h('input', { class: 'range', attrs: { type: 'range', min: '0', max: '100', value: String(Math.round(getVolume() * 100)) } });
  vol.addEventListener('input', () => setVolume(Number(vol.value) / 100));
  const sens = h('input', { class: 'range', attrs: { type: 'range', min: '50', max: '200', value: String(Math.round(p.sens * 100)) } });
  sens.addEventListener('input', () => savePrefs({ ...loadPrefs(), sens: Number(sens.value) / 100 }));
  const box = h(
    'div',
    { class: 'panel menu-modal' },
    h('h2', { text: 'Configurações' }),
    h('div', { class: 'setting' }, h('span', { text: 'Gráficos' }), segmented(qualityOptions(), p.quality, (q) => { savePrefs({ ...loadPrefs(), quality: q }); a.setQuality(q); })),
    h('div', { class: 'setting' }, h('span', { text: 'Pano da mesa' }), segmented(FELTS.map((f) => ({ value: f.id, label: f.name.split(' ')[0]! })), p.felt, (id) => { savePrefs({ ...loadPrefs(), felt: id }); a.setFelt(id); })),
    h('div', { class: 'setting' }, h('span', { text: 'Volume' }), vol),
    h('div', { class: 'setting' }, h('span', { text: 'Sensibilidade da mira' }), sens),
    h('div', { class: 'setting' }, h('span', { text: 'Linha de mira' }), segmented([{ value: 1, label: 'Ligada' }, { value: 0, label: 'Desligada' }], p.guide ? 1 : 0, (v) => savePrefs({ ...loadPrefs(), guide: v === 1 }))),
    h('div', { class: 'setting' }, h('span', { text: 'Tamanho da interface' }), segmented([{ value: 0, label: 'Normal' }, { value: 1, label: 'Grande' }, { value: 2, label: 'Extra' }], p.size, (v) => savePrefs({ ...loadPrefs(), size: v as 0 | 1 | 2 }))),
    btn('Fechar', () => m.close(), 'primary'),
  );
  const m = modal(box);
}

// ---------- jogar contra o bot ----------
function showSetup(a: MenuActions): void {
  const cfg = loadOfflineSettings();
  const modeBox = h('div', { class: 'modes' });
  const renderModes = (): void => {
    clear(modeBox);
    for (const mo of MODES) {
      modeBox.append(
        h('button', { class: `mode-card${cfg.mode === mo.id ? ' active' : ''}`, attrs: { type: 'button' }, on: { click: () => { cfg.mode = mo.id; sndClick(); renderModes(); } } }, h('div', { class: 'mode-name', text: mo.name }), h('div', { class: 'mode-desc', text: mo.desc })),
      );
    }
  };
  renderModes();
  const stats = loadStats();
  const lvl = (l: BotLevel): string => {
    const r = stats.vsBot[l];
    return r ? `${BOT_LABEL[l]} (${r.wins}/${r.games})` : BOT_LABEL[l];
  };
  const box = h(
    'div',
    { class: 'panel setup' },
    h('h2', { text: 'Jogar contra o computador' }),
    modeBox,
    h('div', { class: 'setting' }, h('span', { text: 'Adversário' }), segmented(BOT_LEVELS.map((l) => ({ value: l, label: lvl(l) })), cfg.level, (v) => { cfg.level = v; })),
    h('div', { class: 'muted small', text: 'Fácil: ' + BOT_NAMES.facil + ' · Normal: ' + BOT_NAMES.normal + ' · Difícil: ' + BOT_NAMES.dificil + ' · Mestre: ' + BOT_NAMES.mestre }),
    h('div', { class: 'setting' }, h('span', { text: 'Tempo por tacada' }), segmented(TURN_SECONDS_OPTIONS.map((s) => ({ value: s as number, label: turnLabel(s) })), cfg.turnSeconds as number, (v) => { cfg.turnSeconds = v as TurnSeconds; })),
    h('div', { class: 'row' }, btn('Jogar', () => { saveOfflineSettings(cfg); m.close(); a.startOffline(cfg); }, 'primary'), btn('Cancelar', () => m.close(), 'ghost')),
  );
  const m = modal(box);
}

// ---------- menu ----------
export function showMenu(root: HTMLElement, a: MenuActions, onEditProfile: () => void): () => void {
  clear(root);
  const pwaBox = h('div', { class: 'pwa-box' });
  const off = onPwa((s) => {
    clear(pwaBox);
    if (s.update) pwaBox.append(h('div', { class: 'pwa-line upd' }, h('span', { text: 'Nova versão disponível' }), btn('Atualizar', () => void applyUpdate(), 'primary small')));
    else if (s.phase === 'downloading') pwaBox.append(h('div', { class: 'pwa-line', text: `Baixando para jogar offline… ${s.pct}%` }));
    else if (s.phase === 'ready') pwaBox.append(h('div', { class: 'pwa-line ok', text: '✓ Pronto para jogar offline' }));
    if (s.installable) pwaBox.append(btn('Instalar app', () => void installApp(), 'small'));
    else if (isIos() && !s.standalone) pwaBox.append(h('div', { class: 'pwa-line muted', text: 'iPhone: Compartilhar → Adicionar à Tela de Início' }));
  });
  const st = loadStats();
  const chip = h('button', { class: 'chip', attrs: { type: 'button' }, on: { click: onEditProfile } }, avatarEl(a.profile.name, avatarColor(a.profile.id), a.profile.photo, 'avatar'), h('div', { class: 'chip-t' }, h('div', { class: 'chip-name', text: a.profile.name }), h('div', { class: 'chip-sub', text: st.games ? `${st.wins} vitórias em ${st.games} jogos` : 'Toque para editar o perfil' })));
  const items: HTMLElement[] = [
    btn('Jogar contra o computador', () => { sndClick(); showSetup(a); }, 'primary big'),
    btn('Treino livre', () => { sndClick(); a.startOffline(loadOfflineSettings(), true); }, 'big'),
  ];
  if (a.online) items.push(...onlineButtons(a.online));
  items.push(h('div', { class: 'row tight' }, btn('Como jogar', () => showHelp(), 'ghost'), btn('Configurações', () => showSettings(a), 'ghost')));
  root.append(h('div', { class: 'screen menu' }, h('div', { class: 'menu-col' }, logo(), chip, h('div', { class: 'menu-btns' }, ...items), pwaBox, h('div', { class: 'ver', text: `v${__APP_VERSION__}` }))));
  return off;
}

function onlineButtons(o: OnlineMenu): HTMLElement[] {
  const out: HTMLElement[] = [];
  out.push(btn('Jogar online', () => { sndClick(); showOnline(o); }, 'big'));
  return out;
}

function showOnline(o: OnlineMenu): void {
  const codeIn = h('input', { class: 'input code', attrs: { type: 'text', maxlength: '5', placeholder: 'CÓDIGO', autocapitalize: 'characters', autocomplete: 'off' } });
  const list = h('div', { class: 'rooms' }, h('div', { class: 'muted', text: 'Carregando salas…' }));
  const refresh = async (): Promise<void> => {
    try {
      const rooms = await o.publicRooms();
      clear(list);
      if (!rooms.length) list.append(h('div', { class: 'muted', text: 'Nenhuma sala pública no momento.' }));
      for (const r of rooms) {
        const mo = MODES.find((x) => x.id === r.mode);
        list.append(h('button', { class: 'room-row', attrs: { type: 'button' }, on: { click: () => { m.close(); o.join(r.code); } } }, h('b', { text: r.hostName || 'Sala' }), h('span', { class: 'muted', text: `${mo?.short ?? ''} · ${turnLabel(r.turnSeconds)} · ${r.count}/2` }), h('span', { class: 'code-pill', text: r.code })));
      }
    } catch {
      clear(list);
      list.append(h('div', { class: 'muted', text: 'Sem conexão com o servidor.' }));
    }
  };
  void refresh();
  const join = (): void => {
    const c = codeIn.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(c)) return toast('O código tem 5 letras/números.');
    m.close();
    o.join(c);
  };
  codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && join());
  const box = h(
    'div',
    { class: 'panel online' },
    h('h2', { text: 'Jogar online' }),
    h('div', { class: 'row' }, btn('Criar sala privada', () => { m.close(); void o.create(false); }, 'primary'), btn('Criar sala pública', () => { m.close(); void o.create(true); })),
    h('div', { class: 'row' }, codeIn, btn('Entrar', join)),
    h('h3', { text: 'Salas públicas' }),
    list,
    h('div', { class: 'row' }, btn('Ranking', () => void showRanking(o), 'ghost'), btn('Atualizar lista', () => void refresh(), 'ghost'), btn('Fechar', () => m.close(), 'ghost')),
  );
  const m = modal(box);
}

async function showRanking(o: OnlineMenu): Promise<void> {
  const body = h('div', { class: 'rank' }, h('div', { class: 'muted', text: 'Carregando…' }));
  const m = modal(h('div', { class: 'panel menu-modal' }, h('h2', { text: 'Ranking' }), body, btn('Fechar', () => m.close(), 'primary')));
  try {
    const rows = await o.ranking();
    clear(body);
    if (!rows.length) body.append(h('div', { class: 'muted', text: 'Ainda não há partidas no ranking.' }));
    rows.forEach((r, i) => body.append(h('div', { class: 'rank-row' }, h('span', { class: 'rk', text: String(i + 1) }), h('span', { class: 'rn', text: r.name }), h('span', { class: 'rs', text: `${r.wins}V/${r.games}J` }), h('b', { text: String(r.points) }))));
  } catch {
    clear(body);
    body.append(h('div', { class: 'muted', text: 'Sem conexão com o servidor.' }));
  }
}
