import { BOT_LABEL, BOT_LEVELS, type BotLevel } from '../../shared/bot';
import { BEST_OF_OPTIONS, TURN_SECONDS_OPTIONS, turnLabel, type BestOf, type RoomView, type TurnSeconds } from '../../shared/protocol';
import { MODES, type Mode } from '../../shared/rules';
import { avatarColor } from '../store';
import type { Backend } from '../backend';
import { avatarEl, btn, h, segmented, toast } from './dom';

/** Saguão da sala online: código/convite, jogadores e ajustes (o anfitrião manda). */
export class LobbyPanel {
  el = h('div', { class: 'screen center lobby' });
  private botLevel: BotLevel = 'normal';

  constructor(
    private backend: Backend,
    private myId: string,
    private onLeave: () => void,
  ) {}

  private invite(code: string): void {
    const link = `${location.origin}${location.pathname}?sala=${code}`;
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) void nav.share({ title: 'Sinuca 3D', text: `Vem jogar sinuca comigo! Sala ${code}`, url: link }).catch(() => {});
    else void navigator.clipboard?.writeText(link).then(() => toast('Link copiado!'), () => toast(link));
  }

  render(v: RoomView, photos: Record<string, string>): void {
    const isHost = v.hostId === this.myId;
    const slots = [0, 1].map((seat) => {
      const p = v.players.find((x) => x.seat === seat);
      if (!p) return h('div', { class: 'slot empty' }, h('div', { class: 'avatar initial', text: '?', style: { background: '#2a3038' } }), h('div', { class: 'slot-n muted', text: 'Aguardando jogador…' }));
      return h(
        'div',
        { class: `slot${p.id === this.myId ? ' me' : ''}` },
        avatarEl(p.name, avatarColor(p.id), photos[p.id] ?? null, 'avatar'),
        h('div', { class: 'slot-t' }, h('div', { class: 'slot-n', text: p.name + (p.isHost ? ' · anfitrião' : '') }), h('div', { class: 'slot-s muted', text: p.bot ? `Bot ${BOT_LABEL[(p.botLevel ?? 'normal') as BotLevel]}` : p.connected ? 'Conectado' : 'Desconectado' })),
        isHost && p.id !== this.myId ? btn('Remover', () => (p.bot ? this.backend.bot(false, 'normal') : this.backend.kick(p.id)), 'ghost small') : null,
      );
    });
    const hasBot = v.players.some((p) => p.bot);
    const modeLabel = MODES.find((m) => m.id === v.mode)?.name ?? '';
    const settings = isHost
      ? h(
          'div',
          { class: 'lobby-settings' },
          h('div', { class: 'setting' }, h('span', { text: 'Modo' }), segmented(MODES.map((m) => ({ value: m.id as Mode, label: m.name })), v.mode, (m) => this.backend.settings({ mode: m }))),
          h('div', { class: 'setting' }, h('span', { text: 'Tempo por tacada' }), segmented(TURN_SECONDS_OPTIONS.map((s) => ({ value: s as number, label: turnLabel(s) })), v.turnSeconds as number, (s) => this.backend.settings({ turnSeconds: s as TurnSeconds }))),
          h('div', { class: 'setting' }, h('span', { text: 'Partidas' }), segmented(BEST_OF_OPTIONS.map((b) => ({ value: b as number, label: b === 1 ? 'Única' : `Melhor de ${b}` })), v.bestOf as number, (b) => this.backend.settings({ bestOf: b as BestOf }))),
          v.players.length < 2 || hasBot
            ? h('div', { class: 'setting' }, h('span', { text: 'Jogar contra bot' }), h('div', { class: 'row tight' }, segmented(BOT_LEVELS.map((l) => ({ value: l, label: BOT_LABEL[l] })), this.botLevel, (l) => { this.botLevel = l; if (hasBot) this.backend.bot(true, l); }), hasBot ? btn('Tirar bot', () => this.backend.bot(false, this.botLevel), 'ghost small') : btn('Adicionar bot', () => this.backend.bot(true, this.botLevel), 'small')))
            : null,
        )
      : h('div', { class: 'lobby-settings muted' }, h('div', { text: `Modo: ${modeLabel}` }), h('div', { text: `Tempo por tacada: ${turnLabel(v.turnSeconds)} · ${v.bestOf === 1 ? 'partida única' : `melhor de ${v.bestOf}`}` }), h('div', { text: 'O anfitrião escolhe os ajustes e começa a partida.' }));
    const canStart = v.players.length === 2 && v.players.every((p) => p.connected);
    const box = h(
      'div',
      { class: 'panel lobby-box' },
      h('div', { class: 'lobby-code' }, h('div', { class: 'muted small', text: v.isPublic ? 'SALA PÚBLICA' : 'SALA PRIVADA' }), h('div', { class: 'code-big', text: v.code }), h('div', { class: 'row' }, btn('Convidar', () => this.invite(v.code), 'small'), btn('Copiar código', () => void navigator.clipboard?.writeText(v.code).then(() => toast('Código copiado!')), 'ghost small'))),
      h('div', { class: 'slots' }, ...slots),
      settings,
      h('div', { class: 'row' }, isHost ? btn(canStart ? 'Começar partida' : 'Esperando jogadores…', () => this.backend.start(), `primary${canStart ? '' : ' disabled'}`) : h('div', { class: 'muted', text: 'Aguardando o anfitrião começar…' }), btn('Sair', () => this.onLeave(), 'ghost')),
    );
    this.el.replaceChildren(box);
  }
}
