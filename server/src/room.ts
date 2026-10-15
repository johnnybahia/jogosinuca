import { thinkMs, type BotLevel } from '../../shared/bot';
import { MAX_PHOTO_CHARS, type ClientMsg, type RoomView, type ServerMsg, type ShotEvent } from '../../shared/protocol';
import { cleanName, newRoom, RoomCore, type RoomData } from '../../shared/room';
import type { Env } from './env';

interface Stored {
  d: RoomData;
  botAt: number | null;
  /** id → quando perde o lugar se não voltar */
  away: Record<string, number>;
  /** a sala some depois disso se ninguém fizer nada */
  idleAt: number;
  /** partidas já enviadas ao ranking (contador de partidas da sessão) */
  recorded: number;
}

const LOBBY_IDLE_MS = 12 * 60 * 1000;
const PLAY_IDLE_MS = 40 * 60 * 1000;
const END_IDLE_MS = 30 * 60 * 1000;
/** No saguão, quem perde a conexão (ex.: foi mandar o convite) tem este tempo para voltar. */
const LOBBY_GRACE_MS = 5 * 60 * 1000;
/** Em partida, quem fica desconectado por tanto tempo perde por abandono. */
const PLAY_GRACE_MS = 2 * 60 * 1000;
const MAX_MSG = 20_000;

const validPhoto = (p: unknown): p is string => typeof p === 'string' && p.length <= MAX_PHOTO_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p);
const num = (n: unknown, d = 0): number => (typeof n === 'number' && Number.isFinite(n) ? n : d);

export class GameRoom implements DurableObject {
  private s: Stored | null = null;
  private core: RoomCore | null = null;
  private photos: Record<string, string> = {};
  /** câmera/microfone de cada jogador (só em memória: a mídia acaba junto com a conexão) */
  private media: Record<string, { cam: boolean; mic: boolean }> = {};
  private loaded: Promise<void>;

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    this.loaded = ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<Stored>('s')) ?? null;
      if (this.s) this.core = new RoomCore(this.s.d);
      this.photos = (await ctx.storage.get<Record<string, string>>('photos')) ?? {};
    });
  }

  // ---------- infraestrutura ----------
  private async persist(): Promise<void> {
    if (this.s) await this.ctx.storage.put('s', this.s);
  }

  private online(): Map<string, WebSocket> {
    const m = new Map<string, WebSocket>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as { id?: string } | null;
      if (a?.id) m.set(a.id, ws);
    }
    return m;
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket já fechado */
    }
  }

  private err(ws: WebSocket, msg: string): void {
    this.send(ws, { t: 'error', msg });
  }

  private view(forId: string): RoomView {
    const on = this.online();
    return this.core!.view(forId, Date.now(), (id) => on.has(id), this.media);
  }

  private broadcast(): void {
    if (!this.core) return;
    for (const [id, ws] of this.online()) this.send(ws, this.view(id));
  }

  private broadcastShot(ev: ShotEvent): void {
    for (const ws of this.online().values()) this.send(ws, ev);
  }

  private touch(): void {
    const s = this.s!;
    const p = s.d.phase;
    s.idleAt = Date.now() + (p === 'lobby' ? LOBBY_IDLE_MS : p === 'playing' ? PLAY_IDLE_MS : END_IDLE_MS);
  }

  private async listing(): Promise<void> {
    const s = this.s;
    if (!s) return;
    const stub = this.env.LOBBY.get(this.env.LOBBY.idFromName('global'));
    try {
      const d = s.d;
      if (d.isPublic && d.phase === 'lobby' && d.players.some((p) => !p.bot)) {
        const host = d.players.find((p) => p.id === d.hostId);
        await stub.fetch('https://lobby/upsert', { method: 'POST', body: JSON.stringify({ code: d.code, hostName: host?.name ?? '', count: d.players.length, mode: d.mode, turnSeconds: d.turnSeconds }) });
      } else {
        await stub.fetch('https://lobby/remove', { method: 'POST', body: JSON.stringify({ code: d.code }) });
      }
    } catch {
      /* a lista pública é opcional */
    }
  }

  private async destroy(): Promise<void> {
    const code = this.s?.d.code;
    this.s = null;
    this.core = null;
    this.photos = {};
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(4404, 'closed');
      } catch {
        /* ok */
      }
    }
    if (code) {
      try {
        await this.env.LOBBY.get(this.env.LOBBY.idFromName('global')).fetch('https://lobby/remove', { method: 'POST', body: JSON.stringify({ code }) });
      } catch {
        /* ok */
      }
    }
  }

  private async logError(where: string, e: unknown): Promise<void> {
    try {
      await this.env.RANKING.get(this.env.RANKING.idFromName('global')).fetch('https://ranking/err', { method: 'POST', body: JSON.stringify({ w: where, msg: e instanceof Error ? e.message : String(e) }) });
    } catch {
      /* ok */
    }
  }

  /** Marca o próximo alarme (o mais cedo entre prazo da vez, bot, ausência e ociosidade). */
  private async rearm(): Promise<void> {
    const s = this.s;
    if (!s) return;
    const times: number[] = [s.idleAt];
    if (s.d.phase === 'playing') {
      if (s.d.turnEndsAt) times.push(s.d.turnEndsAt);
      if (s.botAt) times.push(s.botAt);
    }
    for (const t of Object.values(s.away)) times.push(t);
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 40, Math.min(...times)));
  }

  private scheduleBot(extraMs: number): void {
    const s = this.s!;
    const bot = this.core!.botTurn();
    s.botAt = bot ? Date.now() + extraMs + thinkMs((bot.botLevel ?? 'normal') as BotLevel) : null;
  }

  /** Depois de qualquer mudança: guarda, envia, registra fim de partida e rearma. */
  private async after(opts: { shot?: ShotEvent; botExtra?: number; list?: boolean } = {}): Promise<void> {
    const s = this.s;
    if (!s || !this.core) return;
    if (opts.shot) this.broadcastShot(opts.shot);
    this.touch();
    this.scheduleBot(opts.botExtra ?? 800);
    await this.record();
    await this.persist();
    this.broadcast();
    if (opts.list) await this.listing();
    await this.rearm();
  }

  /** Resultado de partida entre duas pessoas vai para o ranking (contra bot não conta). */
  private async record(): Promise<void> {
    const s = this.s!;
    const d = s.d;
    if (d.phase !== 'ended' || !d.result || s.recorded >= d.gamesDone) return;
    s.recorded = d.gamesDone;
    const humans = d.players.filter((p) => !p.bot);
    if (humans.length !== 2) return;
    const win = d.players.find((p) => p.seat === d.result!.winner);
    const lose = d.players.find((p) => p.seat !== d.result!.winner);
    if (!win || !lose || win.bot || lose.bot) return;
    try {
      await this.env.RANKING.get(this.env.RANKING.idFromName('global')).fetch('https://ranking/result', {
        method: 'POST',
        body: JSON.stringify({ winner: { id: win.id, name: win.name }, loser: { id: lose.id, name: lose.name }, forfeit: !!d.result.forfeit }),
      });
    } catch (e) {
      await this.logError('ranking', e);
    }
  }

  // ---------- HTTP / WebSocket ----------
  async fetch(req: Request): Promise<Response> {
    await this.loaded;
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/init') {
      if (this.s) return new Response('exists', { status: 409 });
      const b = (await req.json()) as { code: string; mode?: string; turnSeconds?: number; isPublic?: boolean; bestOf?: number };
      const d = newRoom(b.code, { mode: b.mode as never, turnSeconds: b.turnSeconds, isPublic: !!b.isPublic, bestOf: b.bestOf });
      this.s = { d, botAt: null, away: {}, idleAt: Date.now() + LOBBY_IDLE_MS, recorded: 0 };
      this.core = new RoomCore(d);
      await this.persist();
      await this.rearm();
      return new Response('ok');
    }
    if (req.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      if (!this.s) {
        this.send(pair[1], { t: 'error', msg: 'Sala não existe ou já terminou.' });
        pair[1].close(4404, 'no room');
      }
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.loaded;
    if (typeof raw !== 'string' || raw.length > MAX_MSG || !this.s || !this.core) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    try {
      await this.handle(ws, msg);
    } catch (e) {
      await this.logError(`msg:${(msg as { t?: string }).t}`, e);
    }
  }

  private async handle(ws: WebSocket, msg: ClientMsg): Promise<void> {
    const s = this.s!;
    const core = this.core!;
    if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
    if (msg.t === 'join') return this.onJoin(ws, msg);
    const me = (ws.deserializeAttachment() as { id?: string } | null)?.id;
    if (!me) return;
    const now = Date.now();
    switch (msg.t) {
      case 'start': {
        if (me !== s.d.hostId || (s.d.phase !== 'lobby' && !(s.d.phase === 'ended' && s.d.seriesOver))) return;
        const on = this.online();
        const why = core.canStart((id) => on.has(id));
        if (why) return this.err(ws, why);
        core.start(me, now);
        s.botAt = null;
        await this.after({ list: true, botExtra: 1200 });
        return;
      }
      case 'next': {
        if (core.next(me, now)) await this.after({ botExtra: 1200 });
        return;
      }
      case 'settings': {
        if (core.setSettings(me, msg)) await this.after({ list: true });
        return;
      }
      case 'bot': {
        if (core.setBot(me, !!msg.on, msg.level)) await this.after({ list: true });
        return;
      }
      case 'kick': {
        const target = this.online().get(String(msg.id));
        if (core.kick(me, String(msg.id))) {
          if (target) {
            this.send(target, { t: 'kicked' });
            target.close(4001, 'kicked');
          }
          delete s.away[String(msg.id)];
          await this.after({ list: true });
        }
        return;
      }
      case 'shot': {
        const r = core.shot(me, { dx: num(msg.dx), dy: num(msg.dy), v: num(msg.v), a: num(msg.a), b: num(msg.b), cue: msg.cue ? { x: num(msg.cue.x), y: num(msg.cue.y) } : undefined }, now);
        if ('error' in r) return this.err(ws, r.error);
        await this.after({ shot: r.ev, botExtra: Math.round(r.simSeconds * 1000) + 1400 });
        return;
      }
      case 'aim': {
        // mira ao vivo: só do jogador da vez, repassada aos demais (sem guardar)
        if (core.d.phase !== 'playing' || core.turnPlayer?.id !== me) return;
        const out: ServerMsg = { t: 'aim', from: me, angle: num(msg.angle), a: Math.max(-1, Math.min(1, num(msg.a))), b: Math.max(-1, Math.min(1, num(msg.b))), pull: Math.max(0, Math.min(0.4, num(msg.pull))), cx: msg.cx === undefined ? undefined : num(msg.cx), cy: msg.cy === undefined ? undefined : num(msg.cy) };
        for (const [id, o] of this.online()) if (id !== me) this.send(o, out);
        return;
      }
      case 'media': {
        this.media[me] = { cam: !!msg.cam, mic: !!msg.mic };
        this.broadcast();
        return;
      }
      case 'rtc': {
        // sinalização do vídeo ao vivo: só repassa para o destinatário
        const target = this.online().get(String(msg.to));
        if (target && JSON.stringify(msg.data ?? null).length < 20000) this.send(target, { t: 'rtc', from: me, data: msg.data });
        return;
      }
      case 'emote': {
        const n = Math.floor(num(msg.n, -1));
        if (n < 0 || n > 9) return;
        for (const [id, o] of this.online()) if (id !== me) this.send(o, { t: 'emote', from: me, n });
        return;
      }
      case 'leave': {
        core.leave(me, now);
        delete s.away[me];
        ws.serializeAttachment({});
        try {
          ws.close(1000, 'leave');
        } catch {
          /* ok */
        }
        if (s.d.players.length === 0) return this.destroy();
        await this.after({ list: true });
        return;
      }
    }
  }

  private async onJoin(ws: WebSocket, msg: Extract<ClientMsg, { t: 'join' }>): Promise<void> {
    const s = this.s!;
    const core = this.core!;
    const id = String(msg.id ?? '');
    if (id.length < 8 || id.length > 64) return this.err(ws, 'Identificador inválido.');
    const name = cleanName(msg.name);
    const r = core.join(id, name);
    if (!r.ok) {
      this.err(ws, r.error ?? 'Não foi possível entrar.');
      return void ws.close(4003, 'full');
    }
    delete s.away[id];
    const old = this.online().get(id);
    ws.serializeAttachment({ id });
    if (old && old !== ws) {
      this.send(old, { t: 'kicked' });
      old.close(4000, 'replaced');
    }
    if (validPhoto(msg.photo)) {
      this.photos[id] = msg.photo;
      await this.ctx.storage.put('photos', this.photos);
      for (const [oid, ows] of this.online()) if (oid !== id) this.send(ows, { t: 'photo', id, data: msg.photo });
    }
    for (const [pid, data] of Object.entries(this.photos)) if (pid !== id) this.send(ws, { t: 'photo', id: pid, data });
    this.touch();
    await this.persist();
    // quem entra recebe o estado já com a posição das bolas (reconexão no meio da partida não repete animação)
    this.send(ws, this.view(id));
    this.broadcast();
    await this.listing();
    await this.rearm();
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.loaded;
    const id = (ws.deserializeAttachment() as { id?: string } | null)?.id;
    if (!id || !this.s || !this.core) return;
    const cur = this.online().get(id);
    if (cur && cur !== ws) return; // já reconectou em outro socket
    await this.onDisconnect(id);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private async onDisconnect(id: string): Promise<void> {
    const s = this.s!;
    delete this.media[id];
    const p = s.d.players.find((x) => x.id === id);
    if (!p || p.bot) return;
    const hasOther = [...this.online().keys()].some((x) => x !== id);
    s.away[id] = Date.now() + (s.d.phase === 'lobby' ? LOBBY_GRACE_MS : PLAY_GRACE_MS);
    if (!hasOther && s.d.players.every((x) => x.bot || x.id === id)) {
      // ninguém mais conectado: espera o prazo e some
      s.idleAt = Math.min(s.idleAt, s.away[id]! + 1000);
    }
    await this.persist();
    this.broadcast();
    await this.rearm();
  }

  async alarm(): Promise<void> {
    await this.loaded;
    const s = this.s;
    const core = this.core;
    if (!s || !core) return;
    const now = Date.now();
    const d = s.d;
    if (now >= s.idleAt - 100) return this.destroy();
    // ausentes que passaram do prazo
    let changed = false;
    for (const [id, at] of Object.entries(s.away)) {
      if (at > now + 50) continue;
      delete s.away[id];
      if (this.online().has(id)) continue;
      core.leave(id, now);
      changed = true;
    }
    if (d.players.filter((p) => !p.bot).length === 0) return this.destroy();
    if (d.phase === 'playing') {
      const botP = core.botTurn();
      if (botP && s.botAt !== null && now >= s.botAt - 100) {
        try {
          const plan = core.planBot();
          if (plan) {
            const r = core.shot(botP.id, plan.shot, now);
            if ('error' in r) throw new Error(r.error);
            s.botAt = null;
            await this.after({ shot: r.ev, botExtra: Math.round(r.simSeconds * 1000) + 1400 });
            return;
          }
        } catch (e) {
          await this.logError('bot', e);
          // não deixa a mesa parar: o bot passa a vez com falta
          s.botAt = null;
          const m = d.match;
          if (m) {
            m.turn = 1 - m.turn;
            m.inHand = 'any';
            d.shotSeq++;
          }
          changed = true;
        }
      } else if (!botP) {
        const t = core.timeout(now);
        if (t) {
          for (const ws of this.online().values()) this.send(ws, { t: 'notice', text: t.notice });
          changed = true;
        }
      }
    }
    if (changed) {
      await this.after({ list: true, botExtra: 800 });
      return;
    }
    await this.rearm();
  }
}
