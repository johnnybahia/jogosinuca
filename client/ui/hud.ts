import { groupName, type Group, type MatchState, MODES, POINTS_TO_WIN, groupOf } from '../../shared/rules';
import { avatarColor, loadPrefs, savePrefs } from '../store';
import { avatarEl, h } from './dom';
import { EMOTES, type RoomPlayer, type RoomView } from '../../shared/protocol';

export const BALL_COLORS: Record<number, string> = {
  0: '#f8fafc',
  1: '#f2c11b',
  2: '#2250c8',
  3: '#d92b2b',
  4: '#6a2ec4',
  5: '#ec6a14',
  6: '#17963f',
  7: '#8c1d1d',
  8: '#101114',
};
const colorOf = (n: number): string => BALL_COLORS[n <= 8 ? n : n - 8] ?? '#888';

export function ballIcon(n: number, size = 22): HTMLElement {
  const stripe = n > 8;
  return h('span', { class: `ball${stripe ? ' stripe' : ''}`, style: { '--c': colorOf(n), '--s': `${size}px` } }, h('i', { text: String(n) }));
}

/** Guerra: bola lisa azul ou vermelha (sem número). */
export function guerraDot(group: 'blue' | 'red', size = 18): HTMLElement {
  return h('span', { class: 'gdot', style: { '--c': group === 'blue' ? '#1f55d6' : '#d6262c', '--s': `${size}px` } });
}

export interface HudHandlers {
  onPower(p: number, release: boolean): void;
  onSpin(a: number, b: number): void;
  onView(): void;
  onZoom(): void;
  onTable(): void;
  onContact(): void;
  /** altura da câmera: 0 = base, 1 = linha do taco (rente à mesa) */
  onLow(k: number): void;
  onGuide(): void;
  onSound(): void;
  onMenu(): void;
  onFine(delta: number): void;
  /** passo de ajuste da mira em graus (+ = gira para a direita) */
  onStep(deg: number): void;
  /** volta a câmera base (zoom, inclinação e vistas) */
  onBaseCam(): void;
  onConfirmPlace(): void;
  onCam?(): void;
  onMic?(): void;
  onEmote?(n: number): void;
  onHint?(): void;
}

/** Interface sobre o canvas: cartões dos jogadores, bandeja de bolas, força, efeito, mensagens. */
export class Hud {
  root = h('div', { class: 'hud' });
  private cards: HTMLElement[] = [];
  private trays: HTMLElement[] = [];
  private info = h('div', { class: 'hud-info' });
  private timer = h('div', { class: 'hud-timer' });
  private banner = h('div', { class: 'banner' });
  private power = h('div', { class: 'power' });
  private powerFill = h('div', { class: 'power-fill' });
  private powerKnob = h('div', { class: 'power-knob' });
  private powerLabel = h('div', { class: 'power-label', text: 'FORÇA' });
  private spin = h('div', { class: 'spin' });
  private spinDot = h('div', { class: 'spin-dot' });
  private fine = h('div', { class: 'fine' });
  private fineKnob = h('div', { class: 'fine-knob' });
  private fineDeg = h('div', { class: 'fine-deg' });
  private tools!: HTMLElement;
  private btnToggle!: HTMLButtonElement;
  private hint = h('div', { class: 'hint' });
  private placeBar = h('div', { class: 'placebar' });
  private bannerT = 0;
  private spinVal = { a: 0, b: 0 };
  private btnSound!: HTMLButtonElement;
  private btnGuide!: HTMLButtonElement;
  private btnView!: HTMLButtonElement;
  private btnZoom!: HTMLButtonElement;
  private btnTable!: HTMLButtonElement;
  private btnContact!: HTMLButtonElement;
  private btnLow!: HTMLButtonElement;
  private lowVal = 0;
  private lowKnob = h('div', { class: 'lowv-knob' });
  private lowBox = h('div', { class: 'lowv', attrs: { title: 'Altura da câmera: arraste para baixo para chegar à linha do taco' } });
  private aimInfo = h('div', { class: 'aim-info' });
  private turnChip = h('div', { class: 'turn-chip' });
  private btnCam!: HTMLButtonElement;
  private btnMic!: HTMLButtonElement;
  private btnEmote!: HTMLButtonElement;
  private btnHint!: HTMLButtonElement;
  private powerHint = h('div', { class: 'power-hint' });
  private emotes = h('div', { class: 'emotes' });
  private holder = h('div', { class: 'rtc-holder' });
  private videos = new Map<string, HTMLVideoElement>();
  private seatOf = new Map<string, number>();
  powerVal = 0;
  enabled = false;

  constructor(private hd: HudHandlers) {
    const top = h('div', { class: 'hud-top' });
    for (let i = 0; i < 2; i++) {
      const tray = h('div', { class: 'tray' });
      const card = h('div', { class: `pcard seat${i}` });
      this.cards.push(card);
      this.trays.push(tray);
      top.append(h('div', { class: `pside seat${i}` }, card, tray));
      if (i === 0) top.append(h('div', { class: 'pcenter' }, this.info, this.turnChip, this.timer));
    }
    // botões de topo (à direita)
    const mk = (label: string, title: string, fn: () => void): HTMLButtonElement => h('button', { class: 'ibtn', text: label, attrs: { type: 'button', title, 'aria-label': title }, on: { click: fn } });
    this.btnView = mk('⌖', 'Trocar visão (V)', () => hd.onView());
    this.btnZoom = mk('🔍', 'Zoom de perto (Z)', () => hd.onZoom());
    this.btnTable = mk('▦', 'Vista da mesa (T)', () => hd.onTable());
    this.btnGuide = mk('◎', 'Linha de mira (G)', () => hd.onGuide());
    this.btnSound = mk('♪', 'Som (M)', () => hd.onSound());
    const btnMenu = mk('☰', 'Menu (Esc)', () => hd.onMenu());
    this.btnCam = mk('📷', 'Câmera', () => hd.onCam?.());
    this.btnMic = mk('🎤', 'Microfone', () => hd.onMic?.());
    this.btnEmote = mk('💬', 'Reações', () => this.emotes.classList.toggle('open'));
    this.btnHint = mk('💡', 'Dica de tacada (H)', () => hd.onHint?.());
    this.btnHint.hidden = true;
    for (const b of [this.btnCam, this.btnMic, this.btnEmote]) b.hidden = true;
    EMOTES.forEach((e, i) => this.emotes.append(h('button', { class: 'emote-btn', text: e, attrs: { type: 'button' }, on: { click: () => { this.emotes.classList.remove('open'); hd.onEmote?.(i); } } })));
    // menu lateral recolhível: só ficam visíveis o botão de abrir e o da câmera base
    this.btnToggle = mk('⋯', 'Mostrar/esconder botões', () => this.setToolsOpen(this.tools.classList.contains('closed')));
    this.btnContact = mk('🎯', 'Câmera de contato: de perto onde a branca vai bater', () => hd.onContact());
    this.btnLow = mk('👁', 'Câmera na linha do taco (rente à mesa): toque para alternar', () => {
      // vai até a linha do taco; se já estiver lá, volta à altura base
      const down = this.lowVal < 0.95;
      this.setLow(down ? 1 : 0);
      hd.onLow(down ? 1 : 0);
    });
    // altura da câmera: controle vertical no canto (em cima = base, embaixo = linha do taco)
    this.lowBox.append(h('div', { class: 'lowv-track' }), this.lowKnob);
    {
      let drag = false;
      const val = (e: PointerEvent): number => {
        const r = this.lowBox.getBoundingClientRect();
        return Math.max(0, Math.min(1, (e.clientY - r.top - 8) / (r.height - 16)));
      };
      const set = (e: PointerEvent): void => {
        const k = val(e);
        this.setLow(k);
        hd.onLow(k);
      };
      this.lowBox.addEventListener('pointerdown', (e) => {
        drag = true;
        this.lowBox.setPointerCapture(e.pointerId);
        set(e);
        e.preventDefault();
      });
      this.lowBox.addEventListener('pointermove', (e) => drag && set(e));
      const end = (): void => {
        drag = false;
      };
      this.lowBox.addEventListener('pointerup', end);
      this.lowBox.addEventListener('pointercancel', end);
    }
    const btnBase = mk('🎥', 'Câmera base: volta ao enquadramento original', () => hd.onBaseCam());
    // câmeras sempre visíveis ACIMA do menu; o menu (⋯) abre um painel ao lado, sem empurrar nada
    const panel = h('div', { class: 'tools-panel' }, this.btnView, this.btnTable, this.btnZoom, this.btnGuide, this.btnSound, this.btnHint, this.btnCam, this.btnMic, this.btnEmote, btnMenu);
    const tools = h('div', { class: 'tools closed' }, h('div', { class: 'tools-top' }, this.lowBox, this.btnLow), h('div', { class: 'tools-cam' }, this.btnContact, btnBase), h('div', { class: 'tools-menu' }, this.btnToggle, panel));
    this.tools = tools;
    this.setToolsOpen(loadPrefs().toolsOpen);

    // força: puxe a alça para baixo e solte para tacar
    this.power.append(h('div', { class: 'power-track' }, this.powerFill), this.powerHint, this.powerKnob, this.powerLabel);
    this.bindPower();

    // efeito (ponto de contato na bola branca)
    this.spin.append(h('div', { class: 'spin-ball' }), h('div', { class: 'spin-cross' }), this.spinDot);
    this.bindSpin();

    // ajuste fino da mira
    this.fine.append(h('div', { class: 'fine-track' }), this.fineKnob, h('span', { class: 'fine-l', text: '◂' }), h('span', { class: 'fine-r', text: '▸' }));
    this.bindFine();
    // passos de 1 grau: um toque, um grau (sem arrastar, sem passar do ponto)
    const STEPS = [2, 1, 0.5, 0.2, 0.1];
    let stepDeg = 1;
    try {
      const sv = Number(localStorage.getItem('sinuca_step'));
      if (STEPS.includes(sv)) stepDeg = sv;
    } catch {
      /* ok */
    }
    const lab = (): string => `${stepDeg}°`;
    const stepSel = h('button', { class: 'stepsel', attrs: { type: 'button', title: 'Tamanho do passo', 'aria-label': 'Tamanho do passo' }, text: `Passo ${lab()}`, on: { click: () => {
      stepDeg = STEPS[(STEPS.indexOf(stepDeg) + 1) % STEPS.length]!;
      try {
        localStorage.setItem('sinuca_step', String(stepDeg));
      } catch {
        /* ok */
      }
      stepSel.textContent = `Passo ${lab()}`;
      bl.textContent = `◂ ${lab()}`;
      br.textContent = `${lab()} ▸`;
    } } });
    // um toque, um passo; segurando, repete
    const step = (dir: number): HTMLButtonElement => {
      const b = h('button', { class: 'fstep', attrs: { type: 'button', 'aria-label': dir < 0 ? 'Mirar para a esquerda' : 'Mirar para a direita' } });
      let t = 0;
      let iv = 0;
      const stop = (): void => {
        window.clearTimeout(t);
        window.clearInterval(iv);
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        hd.onStep(dir * stepDeg);
        stop();
        t = window.setTimeout(() => {
          iv = window.setInterval(() => hd.onStep(dir * stepDeg), 110);
        }, 420);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, stop);
      return b;
    };
    const bl = step(-1);
    const br = step(1);
    bl.textContent = `◂ ${lab()}`;
    br.textContent = `${lab()} ▸`;
    const fineWrap = h('div', { class: 'finewrap' }, h('div', { class: 'fine-top' }, this.fineDeg, stepSel), h('div', { class: 'fine-row' }, bl, this.fine, br));

    this.placeBar.append(h('span', { text: 'Arraste a bola branca para posicionar' }), h('button', { class: 'btn primary small', text: 'Confirmar', attrs: { type: 'button' }, on: { click: () => hd.onConfirmPlace() } }));
    this.placeBar.hidden = true;

    this.root.append(top, tools, this.emotes, this.holder, this.banner, this.hint, this.aimInfo, this.power, h('div', { class: 'spinwrap' }, this.spin, h('div', { class: 'spin-label', text: 'EFEITO' })), fineWrap, this.placeBar);
    this.setEnabled(false);
  }

  // ---------- controles ----------
  private bindPower(): void {
    let drag = false;
    const rect = (): DOMRect => this.power.getBoundingClientRect();
    const val = (e: PointerEvent): number => {
      const r = rect();
      const top = r.top + 30;
      const h2 = r.height - 60;
      return Math.max(0, Math.min(1, (e.clientY - top) / h2));
    };
    this.power.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      drag = true;
      this.power.classList.add('drag');
      this.power.setPointerCapture(e.pointerId);
      this.setPower(val(e));
      this.hd.onPower(this.powerVal, false);
      e.preventDefault();
    });
    this.power.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.setPower(val(e));
      this.hd.onPower(this.powerVal, false);
    });
    const end = (e: PointerEvent): void => {
      if (!drag) return;
      drag = false;
      this.power.classList.remove('drag');
      try {
        this.power.releasePointerCapture(e.pointerId);
      } catch {
        /* ok */
      }
      this.hd.onPower(this.powerVal, true);
    };
    this.power.addEventListener('pointerup', end);
    this.power.addEventListener('pointercancel', end);
  }

  private bindSpin(): void {
    let drag = false;
    const apply = (e: PointerEvent): void => {
      const r = this.spin.getBoundingClientRect();
      let x = ((e.clientX - r.left) / r.width) * 2 - 1;
      let y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      const l = Math.sqrt(x * x + y * y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      if (l < 0.12) {
        x = 0;
        y = 0;
      }
      this.setSpin(x * 0.6, y * 0.6);
      this.hd.onSpin(this.spinVal.a, this.spinVal.b);
    };
    this.spin.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      drag = true;
      this.spin.setPointerCapture(e.pointerId);
      apply(e);
      e.preventDefault();
    });
    this.spin.addEventListener('pointermove', (e) => drag && apply(e));
    const end = (): void => {
      drag = false;
    };
    this.spin.addEventListener('pointerup', end);
    this.spin.addEventListener('pointercancel', end);
    this.spin.addEventListener('dblclick', () => {
      this.setSpin(0, 0);
      this.hd.onSpin(0, 0);
    });
  }

  private bindFine(): void {
    let drag = false;
    let v = 0;
    let raf = 0;
    const loop = (): void => {
      if (!drag) return;
      if (Math.abs(v) > 0.04) this.hd.onFine(v);
      raf = requestAnimationFrame(loop);
    };
    const val = (e: PointerEvent): number => {
      const r = this.fine.getBoundingClientRect();
      return Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    };
    this.fine.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      drag = true;
      this.fine.setPointerCapture(e.pointerId);
      v = val(e);
      this.fineKnob.style.left = `${(v * 0.5 + 0.5) * 100}%`;
      raf = requestAnimationFrame(loop);
      e.preventDefault();
    });
    this.fine.addEventListener('pointermove', (e) => {
      if (!drag) return;
      v = val(e);
      this.fineKnob.style.left = `${(v * 0.5 + 0.5) * 100}%`;
    });
    const end = (): void => {
      drag = false;
      v = 0;
      cancelAnimationFrame(raf);
      this.fineKnob.style.left = '50%';
    };
    this.fine.addEventListener('pointerup', end);
    this.fine.addEventListener('pointercancel', end);
  }

  setPower(p: number): void {
    this.powerVal = p;
    const pct = p * 100;
    this.powerFill.style.height = `${pct}%`;
    this.powerKnob.style.top = `calc(30px + (100% - 60px) * ${p})`;
    this.powerLabel.textContent = p > 0.01 ? `${Math.round(p * 100)}%` : 'FORÇA';
  }

  setSpin(a: number, b: number): void {
    this.spinVal = { a, b };
    this.spinDot.style.left = `${50 + (a / 0.6) * 38}%`;
    this.spinDot.style.top = `${50 - (b / 0.6) * 38}%`;
  }

  get spinNow(): { a: number; b: number } {
    return this.spinVal;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.root.classList.toggle('can-play', on);
    if (!on) this.setPower(0);
  }

  setToolsOpen(open: boolean): void {
    this.tools.classList.toggle('closed', !open);
    this.btnToggle.classList.toggle('on', open);
    this.btnToggle.textContent = open ? '✕' : '⋯';
    try {
      savePrefs({ ...loadPrefs(), toolsOpen: open });
    } catch {
      /* sem armazenamento */
    }
  }

  /** Direção da mira em graus (referência para os passos de 1°). */
  setAimDeg(deg: number | null): void {
    this.fineDeg.textContent = deg === null ? '' : `Mira ${(((deg % 360) + 360) % 360).toFixed(2)}°`;
  }

  /** Atualiza o controle de altura (0..1) sem disparar o evento. */
  setLow(k: number): void {
    this.lowVal = k;
    this.lowKnob.style.top = `calc(8px + (100% - 16px) * ${k})`;
    this.btnLow.classList.toggle('on', k > 0);
  }

  setContactOn(on: boolean): void {
    this.btnContact.classList.toggle('on', on);
  }

  setTableOn(on: boolean): void {
    this.btnTable.classList.toggle('on', on);
  }

  setAimInfo(t: string): void {
    this.aimInfo.textContent = t;
    this.aimInfo.classList.toggle('show', !!t);
  }

  setZoomOn(on: boolean): void {
    this.btnZoom.classList.toggle('on', on);
  }

  setPlacing(on: boolean): void {
    this.placeBar.hidden = !on;
    this.root.classList.toggle('placing', on);
  }

  setButtons(s: { top: boolean; guide: boolean; muted: boolean }): void {
    this.btnView.classList.toggle('on', s.top);
    this.btnGuide.classList.toggle('on', s.guide);
    this.btnSound.classList.toggle('off', s.muted);
    this.btnSound.textContent = s.muted ? '✕' : '♪';
  }

  /** Liga os botões de vídeo/reações (só no jogo online); a dica de tacada só fora do online. */
  setOnline(on: boolean): void {
    for (const b of [this.btnCam, this.btnMic, this.btnEmote]) b.hidden = !on;
    this.btnHint.hidden = on;
  }

  /** Marca na barra de força o valor sugerido (null = some). */
  setPowerHint(p: number | null): void {
    this.powerHint.style.display = p === null ? 'none' : 'block';
    if (p !== null) this.powerHint.style.top = `calc(30px + (100% - 60px) * ${p})`;
  }

  setMedia(cam: boolean, mic: boolean): void {
    this.btnCam.classList.toggle('on', cam);
    this.btnMic.classList.toggle('on', mic);
    this.btnCam.textContent = cam ? '📷' : '🚫';
    this.btnMic.textContent = mic ? '🎤' : '🔇';
  }

  /** Vídeo/áudio de um jogador (null = sem fluxo). O elemento fica sempre no documento para o áudio tocar. */
  setStream(id: string, stream: MediaStream | null, self: boolean): void {
    let v = this.videos.get(id);
    if (!stream) {
      v?.remove();
      this.videos.delete(id);
      return;
    }
    if (!v) {
      v = h('video', { class: 'avatar live', attrs: { autoplay: '', playsinline: '' } });
      v.muted = self;
      this.videos.set(id, v);
      this.holder.append(v);
    }
    if (v.srcObject !== stream) v.srcObject = stream;
    void v.play().catch(() => {});
  }

  showEmote(id: string, n: number): void {
    const seat = this.seatOf.get(id);
    const side = this.root.querySelector(`.pside.seat${seat ?? 0}`);
    if (!side) return;
    const b = h('div', { class: 'emote-bubble', text: EMOTES[n] ?? '' });
    side.append(b);
    setTimeout(() => b.remove(), 2600);
  }

  private hintT = 0;
  setHint(t: string, ms = 0): void {
    this.hint.textContent = t;
    this.hint.classList.toggle('show', !!t);
    window.clearTimeout(this.hintT);
    if (t && ms) this.hintT = window.setTimeout(() => this.hint.classList.remove('show'), ms);
  }

  /** Indicador fixo de quem joga. */
  setTurn(text: string, mine: boolean): void {
    this.turnChip.textContent = text;
    this.turnChip.className = `turn-chip${text ? ' show' : ''}${mine ? ' mine' : ''}`;
  }

  showBanner(title: string, sub = '', kind: 'good' | 'bad' | 'info' | 'wait' = 'info', ms = 2200): void {
    this.banner.replaceChildren(h('div', { class: `banner-in ${kind}` }, h('div', { class: 'banner-t', text: title }), sub ? h('div', { class: 'banner-s', text: sub }) : null));
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    window.clearTimeout(this.bannerT);
    this.bannerT = window.setTimeout(() => this.banner.classList.remove('show'), ms);
  }

  setTimer(sec: number | null, mine: boolean): void {
    if (sec === null) {
      this.timer.textContent = '';
      this.timer.className = 'hud-timer';
      return;
    }
    this.timer.textContent = `${Math.max(0, Math.ceil(sec))}s`;
    this.timer.className = `hud-timer show${sec <= 10 ? ' low' : ''}${mine ? ' mine' : ''}`;
  }

  /** Atualiza cartões, bandejas e informações da partida. */
  update(v: RoomView, photos: Record<string, string>, myId: string): void {
    const m = v.match;
    this.root.classList.toggle('practice', !!v.practice);
    for (let seat = 0; seat < 2; seat++) {
      const p = v.players.find((x) => x.seat === seat);
      this.renderCard(seat, p, m, v, photos, myId);
      this.renderTray(seat, p, m);
    }
    for (const [id, el] of this.videos) if (!el.isConnected || !this.root.querySelector('.hud-top')?.contains(el)) this.holder.append(el), void id;
    const mode = MODES.find((x) => x.id === v.mode);
    const kids: (HTMLElement | string)[] = [h('div', { class: 'mode', text: v.practice ? 'Treino livre' : mode?.short ?? '' })];
    if (v.bestOf > 1) kids.push(h('div', { class: 'series', text: `Melhor de ${v.bestOf} · ${v.gamesDone}/${v.bestOf}` }));
    this.info.replaceChildren(...(kids as HTMLElement[]));
  }

  private renderCard(seat: number, p: RoomPlayer | undefined, m: MatchState | null, v: RoomView, photos: Record<string, string>, myId: string): void {
    const card = this.cards[seat]!;
    card.className = `pcard seat${seat}${m && m.turn === seat && v.phase === 'playing' ? ' turn' : ''}${p && p.id === myId ? ' me' : ''}`;
    if (!p) {
      card.replaceChildren();
      return;
    }
    const g: Group | null = m ? m.groups[seat] ?? null : null;
    let sub = '';
    if (v.practice && m) sub = `${m.tray.length} na caçapa`;
    else if (m) {
      if (v.mode === 'guerra') sub = g ? `${groupName(g)} · ${m.balls.filter((b) => b.on && b.id > 0 && groupOf('guerra', b.id) === g).length} na mesa` : '';
      else if (v.mode === 'bola61') sub = `${m.score[seat] ?? 0} / ${POINTS_TO_WIN} pts`;
      else sub = g ? `${groupName(g)} · ${m.score[seat] ?? 0}/7` : 'Mesa aberta';
    }
    this.seatOf.set(p.id, seat);
    const vid = p.cam ? this.videos.get(p.id) : undefined;
    card.replaceChildren(
      ...([
        vid ?? avatarEl(p.name, avatarColor(p.id), photos[p.id] ?? null, 'avatar'),
        h('div', { class: 'pinfo' }, h('div', { class: 'pname', text: `${p.name}${p.title ? ' ★' : ''}` }), h('div', { class: 'psub', text: sub })),
        v.bestOf > 1 ? h('div', { class: 'pwins', text: String(p.wins) }) : null,
        !p.connected && !p.bot ? h('div', { class: 'poff', text: 'off' }) : null,
      ].filter(Boolean) as HTMLElement[]),
    );
  }

  private renderTray(seat: number, p: RoomPlayer | undefined, m: MatchState | null): void {
    const tray = this.trays[seat]!;
    tray.replaceChildren();
    if (!m || !p) return;
    if (this.root.classList.contains('practice')) {
      if (seat === 0) for (const id of m.tray.filter((x) => x > 0)) tray.append(ballIcon(id, 18));
      return;
    }
    if (m.mode === 'bola61') {
      // na 61 a bandeja mostra o que o jogador fez nas últimas tacadas: aqui, só as bolas restantes numa linha única no centro
      if (seat === 0) {
        const left = m.balls.filter((b) => b.on && b.id > 0).map((b) => b.id);
        const row = h('div', { class: 'left-row' });
        for (const id of left) row.append(ballIcon(id, 18));
        tray.append(row);
      }
      return;
    }
    if (m.mode === 'guerra') {
      // a bandeja de cada um mostra as bolas DELE: apagadas as que já saíram da mesa
      const g = m.groups[seat];
      if (g !== 'blue' && g !== 'red') return;
      for (let id = 1; id <= 14; id++) {
        if (groupOf('guerra', id) !== g) continue;
        const dot = guerraDot(g, 18);
        if (!m.balls.some((b) => b.id === id && b.on)) dot.classList.add('potted');
        tray.append(dot);
      }
      return;
    }
    const g = m.groups[seat];
    if (!g) return;
    const mine = m.tray.filter((id) => id > 0 && id !== 8 && groupOf(m.mode, id) === g);
    const all = m.balls.filter((b) => b.id > 0 && b.id !== 8 && groupOf(m.mode, b.id) === g).map((b) => b.id).sort((a, b) => a - b);
    for (const id of all) {
      const ic = ballIcon(id, 18);
      if (mine.includes(id)) ic.classList.add('potted');
      tray.append(ic);
    }
    const eight = m.tray.includes(8);
    const ic8 = ballIcon(8, 18);
    if (eight) ic8.classList.add('potted');
    if (all.every((id) => mine.includes(id))) tray.append(ic8);
  }
}
