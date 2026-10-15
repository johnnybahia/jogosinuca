import type { LobbyRoom } from '../../shared/protocol';

interface Entry extends LobbyRoom {
  updated: number;
}

const STALE_MS = 15 * 60 * 1000;

/** Lista de salas públicas que ainda estão no saguão. */
export class Lobby implements DurableObject {
  private rooms = new Map<string, Entry>();
  private loaded: Promise<void>;

  constructor(private ctx: DurableObjectState) {
    this.loaded = ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<Record<string, Entry>>('rooms');
      if (saved) this.rooms = new Map(Object.entries(saved));
    });
  }

  private save(): Promise<void> {
    return this.ctx.storage.put('rooms', Object.fromEntries(this.rooms));
  }

  async fetch(req: Request): Promise<Response> {
    await this.loaded;
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/upsert') {
      const e = (await req.json()) as LobbyRoom;
      this.rooms.set(e.code, { ...e, updated: Date.now() });
      await this.save();
      return new Response('ok');
    }
    if (req.method === 'POST' && url.pathname === '/remove') {
      const { code } = (await req.json()) as { code: string };
      if (this.rooms.delete(code)) await this.save();
      return new Response('ok');
    }
    if (req.method === 'GET' && url.pathname === '/list') {
      const now = Date.now();
      let dirty = false;
      for (const [code, e] of this.rooms) {
        if (now - e.updated > STALE_MS) {
          this.rooms.delete(code);
          dirty = true;
        }
      }
      if (dirty) await this.save();
      const list: LobbyRoom[] = [...this.rooms.values()].map(({ code, hostName, count, mode, turnSeconds }) => ({ code, hostName, count, mode, turnSeconds }));
      return Response.json(list);
    }
    return new Response('not found', { status: 404 });
  }
}
