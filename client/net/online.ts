import type { Backend, BackendEvents } from '../backend';
import { noopEvents } from '../backend';
import { wsUrl } from '../api';
import type { AimMsg, BestOf, BotLevel, ClientMsg, ServerMsg, ShotMsg, TurnSeconds } from '../../shared/protocol';
import type { Mode } from '../../shared/rules';
import type { Profile } from '../store';

export class OnlineBackend implements Backend {
  readonly mode = 'online' as const;
  events: BackendEvents = noopEvents;
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private retry = 0;
  private pingTimer = 0;
  private reconnectTimer = 0;
  private onVisible = (): void => {
    // voltou para o jogo (ex.: depois de mandar o convite): reconecta já, sem esperar o próximo ciclo
    if (document.visibilityState !== 'visible' || this.closedByUs) return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      window.clearTimeout(this.reconnectTimer);
      this.retry = 0;
      this.connect();
    }
  };

  constructor(
    private code: string,
    private profile: Profile,
  ) {
    document.addEventListener('visibilitychange', this.onVisible);
  }

  connect(): void {
    this.closedByUs = false;
    this.events.onConn('connecting');
    const ws = new WebSocket(wsUrl(this.code));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.events.onConn('open');
      this.send({ t: 'join', id: this.profile.id, name: this.profile.name, photo: this.profile.photo ?? undefined });
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 20000);
    };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      switch (m.t) {
        case 'state':
          this.events.onView(m);
          break;
        case 'shot':
          this.events.onShot(m);
          break;
        case 'aim':
          this.events.onAim(m.from, m);
          break;
        case 'photo':
          this.events.onPhoto(m.id, m.data);
          break;
        case 'rtc':
          this.events.onRtc(m.from, m.data);
          break;
        case 'emote':
          this.events.onEmote(m.from, m.n);
          break;
        case 'notice':
          this.events.onNotice(m.text);
          break;
        case 'error':
          this.events.onError(m.msg);
          break;
        case 'kicked':
          this.closedByUs = true;
          this.events.onKicked();
          break;
      }
    };
    ws.onclose = (e) => {
      window.clearInterval(this.pingTimer);
      this.events.onConn('closed');
      // 4404/4003: sala inexistente, cheia ou já iniciada — não adianta tentar de novo
      if (this.closedByUs || e.code === 4404 || e.code === 4003 || e.code === 4001) {
        if (e.code === 4404 || e.code === 4003) this.events.onKicked();
        return;
      }
      const delay = Math.min(8000, 800 * 2 ** this.retry++);
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  start(): void {
    this.send({ t: 'start' });
  }
  settings(opts: { mode?: Mode; turnSeconds?: TurnSeconds; bestOf?: BestOf }): void {
    this.send({ t: 'settings', ...opts });
  }
  shot(msg: ShotMsg): void {
    this.send({ t: 'shot', ...msg });
  }
  aim(a: AimMsg): void {
    this.send({ t: 'aim', ...a });
  }
  next(): void {
    this.send({ t: 'next' });
  }
  bot(on: boolean, level: BotLevel): void {
    this.send({ t: 'bot', on, level });
  }
  kick(id: string): void {
    this.send({ t: 'kick', id });
  }
  media(cam: boolean, mic: boolean): void {
    this.send({ t: 'media', cam, mic });
  }
  assist(on: boolean): void {
    this.send({ t: 'assist', on });
  }
  rtc(to: string, data: unknown): void {
    this.send({ t: 'rtc', to, data });
  }
  emote(n: number): void {
    this.send({ t: 'emote', n });
  }
  leave(): void {
    this.closedByUs = true;
    document.removeEventListener('visibilitychange', this.onVisible);
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    this.send({ t: 'leave' });
    this.ws?.close(1000, 'leave');
  }
}
