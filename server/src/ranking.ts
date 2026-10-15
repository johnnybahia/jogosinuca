import type { RankingRow } from '../../shared/protocol';

type Row = { id: string; name: string; games: number; wins: number; rating: number; streak: number; updated: number };

const START = 1000;
const K = 28;

/** Ranking global por pontuação (Elo): só partidas entre duas pessoas contam. Também reserva os nomes. */
export class Ranking implements DurableObject {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState) {
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL, rating REAL NOT NULL, streak INTEGER NOT NULL, updated INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS names (id TEXT PRIMARY KEY, norm TEXT NOT NULL UNIQUE, name TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS errors (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, w TEXT NOT NULL, msg TEXT NOT NULL)');
  }

  private get(id: string, name: string): Row {
    const r = this.sql.exec<Row>('SELECT * FROM players WHERE id = ?', id).toArray()[0];
    return r ?? { id, name, games: 0, wins: 0, rating: START, streak: 0, updated: 0 };
  }

  private save(r: Row): void {
    this.sql.exec(
      `INSERT INTO players (id, name, games, wins, rating, streak, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, games = excluded.games, wins = excluded.wins, rating = excluded.rating, streak = excluded.streak, updated = excluded.updated`,
      r.id,
      r.name,
      r.games,
      r.wins,
      r.rating,
      r.streak,
      Date.now(),
    );
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/result') {
      const b = (await req.json()) as { winner?: { id?: string; name?: string }; loser?: { id?: string; name?: string }; forfeit?: boolean };
      const w = this.get(String(b.winner?.id ?? '').slice(0, 64), String(b.winner?.name ?? '').slice(0, 16) || 'Jogador');
      const l = this.get(String(b.loser?.id ?? '').slice(0, 64), String(b.loser?.name ?? '').slice(0, 16) || 'Jogador');
      if (w.id.length < 8 || l.id.length < 8 || w.id === l.id) return Response.json({ ok: false }, { status: 400 });
      w.name = String(b.winner?.name ?? w.name).slice(0, 16) || w.name;
      l.name = String(b.loser?.name ?? l.name).slice(0, 16) || l.name;
      const ew = 1 / (1 + Math.pow(10, (l.rating - w.rating) / 400));
      const gain = K * (1 - ew);
      w.rating += gain;
      l.rating -= b.forfeit ? gain * 1.25 : gain;
      w.games++;
      l.games++;
      w.wins++;
      w.streak = Math.max(0, w.streak) + 1;
      l.streak = 0;
      this.save(w);
      this.save(l);
      return Response.json({ ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/top') {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const rows = this.sql.exec<Row>('SELECT * FROM players WHERE games > 0 ORDER BY rating DESC, wins DESC, games ASC LIMIT ?', limit).toArray();
      const out: RankingRow[] = rows.map((r) => ({ id: r.id, name: r.name, games: r.games, wins: r.wins, points: Math.round(r.rating), streak: r.streak }));
      return Response.json(out);
    }
    // reserva de nome: um nome pertence a um id; trocar de nome libera o anterior
    if (req.method === 'POST' && url.pathname === '/claim') {
      const b = (await req.json()) as { id?: string; name?: string };
      const id = String(b.id ?? '').slice(0, 64);
      const name = String(b.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 16);
      const norm = name.toLowerCase();
      if (id.length < 8 || name.length < 2) return Response.json({ ok: false, error: 'inválido' }, { status: 400 });
      const owner = this.sql.exec<{ id: string }>('SELECT id FROM names WHERE norm = ?', norm).toArray()[0];
      if (owner && owner.id !== id) return Response.json({ ok: false, error: 'em uso' }, { status: 409 });
      this.sql.exec('INSERT INTO names (id, norm, name) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET norm = excluded.norm, name = excluded.name', id, norm, name);
      return Response.json({ ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/release') {
      const b = (await req.json()) as { name?: string };
      this.sql.exec('DELETE FROM names WHERE norm = ?', String(b.name ?? '').trim().replace(/\s+/g, ' ').toLowerCase());
      return new Response('ok');
    }
    if (req.method === 'POST' && url.pathname === '/err') {
      const b = (await req.json().catch(() => null)) as { w?: string; msg?: string } | null;
      if (!b) return Response.json({ ok: false }, { status: 400 });
      const row = this.sql.exec<{ id: number }>('INSERT INTO errors (t, w, msg) VALUES (?, ?, ?) RETURNING id', Date.now(), String(b.w ?? '').slice(0, 40), String(b.msg ?? '').slice(0, 600)).one();
      this.sql.exec('DELETE FROM errors WHERE id <= ?', row.id - 200);
      return Response.json({ ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/errors') {
      const rows = this.sql.exec<{ id: number; t: number; w: string; msg: string }>('SELECT id, t, w, msg FROM errors ORDER BY id DESC LIMIT 100').toArray();
      return Response.json(rows.map((r) => ({ n: r.id, quando: new Date(r.t).toISOString(), onde: r.w, erro: r.msg })));
    }
    if (req.method === 'POST' && url.pathname === '/errorsclear') {
      this.sql.exec('DELETE FROM errors');
      return new Response('ok');
    }
    if (req.method === 'POST' && url.pathname === '/reset') {
      this.sql.exec('DELETE FROM players');
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }
}
