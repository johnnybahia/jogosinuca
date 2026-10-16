// Teste de ponta a ponta do servidor: com `npm run server:dev` ligado, roda `node scripts/e2e-server.mjs`.
// Cria uma sala, entram 2 clientes, jogam tacadas até o fim de algumas rodadas e conferem que os dois veem o mesmo.
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const log = (...a) => console.log('•', ...a);
const fail = (m) => { console.error('✗ FALHOU:', m); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(code, id, name) {
    this.id = id; this.name = name; this.view = null; this.shots = []; this.errors = []; this.msgs = []; this.notices = [];
    this.ws = new WebSocket(`${WS}/ws/${code}`);
    this.ready = new Promise((res) => { this.ws.onopen = () => { this.ws.send(JSON.stringify({ t: 'join', id, name })); res(); }; });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      this.msgs.push(m.t);
      if (m.t === 'state') this.view = m;
      else if (m.t === 'shot') this.shots.push(m);
      else if (m.t === 'error') this.errors.push(m.msg);
      else if (m.t === 'notice') this.notices.push(m.text);
    };
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async until(fn, ms = 15000, what = 'condição') {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return; await sleep(50); }
    fail(`tempo esgotado esperando ${what}`);
  }
}

const api = async (path, init) => { const r = await fetch(BASE + path, init); if (!r.ok) fail(`${path} -> ${r.status}`); return r.json(); };

// 1) ping e criação
await api('/api/ping');
const { code } = await api('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'bola61', turnSeconds: 30, isPublic: true, bestOf: 1 }) });
log('sala criada', code);
const rooms = await api('/api/rooms');
if (rooms.some((r) => r.code === code)) log('(sala ainda não aparece na lista: normal, só quando alguém entra)'); 

// 2) dois jogadores entram
const a = new Client(code, 'player-aaaaaaaa-0001', 'Ana');
await a.ready;
await a.until(() => a.view && a.view.players.length === 1, 8000, 'Ana no saguão');
const b = new Client(code, 'player-bbbbbbbb-0002', 'Beto');
await b.ready;
await a.until(() => a.view.players.length === 2 && b.view?.players.length === 2, 8000, 'dois jogadores');
log('saguão com 2 jogadores; anfitrião =', a.view.players.find((p) => p.isHost).name);
const pub = await api('/api/rooms');
if (!pub.some((r) => r.code === code)) fail('sala pública não apareceu na lista');
log('sala pública listada');

// 3) terceiro é recusado
const c = new Client(code, 'player-cccccccc-0003', 'Carla');
await c.ready;
await sleep(600);
if (!c.errors.length) fail('terceiro jogador deveria ser recusado');
log('terceiro recusado:', c.errors[0]);

// 3b) privacidade: o id de verdade nunca aparece para os outros (ninguém consegue tomar o lugar de ninguém)
for (const [cl, raw] of [[a, a.id], [b, b.id]]) {
  const txt = JSON.stringify(cl.view);
  if (txt.includes('player-aaaaaaaa') || txt.includes('player-bbbbbbbb')) fail('o estado da sala vazou o id real de um jogador');
  if (cl.view.you === raw) fail('"you" deveria ser o id público');
}
log('ids públicos: o id real não vaza');

// 4) só o anfitrião muda ajustes e inicia
b.send({ t: 'settings', mode: 'par_impar' });
await sleep(300);
if (a.view.mode !== 'bola61') fail('convidado não pode mudar o modo');
a.send({ t: 'settings', mode: 'par_impar', turnSeconds: 60 });
await a.until(() => a.view.mode === 'par_impar' && a.view.turnSeconds === 60, 5000, 'ajustes do anfitrião');
a.send({ t: 'start' });
await a.until(() => a.view.phase === 'playing' && b.view.phase === 'playing', 8000, 'início da partida');
log('partida iniciada; vez de', a.view.players.find((p) => p.seat === a.view.match.turn).name);

// 5) tacadas: quem não é da vez leva erro; da vez joga
const turnSeat = () => a.view.match.turn;
const whose = () => (a.view.players.find((p) => p.seat === turnSeat()).id === a.view.you ? a : b);
const other = () => (whose() === a ? b : a);
const errN = other().errors.length;
other().send({ t: 'shot', dx: 1, dy: 0, v: 3, a: 0, b: 0 });
await other().until(() => other().errors.length > errN, 5000, 'erro de tacada fora da vez');
log('tacada fora da vez recusada');

let shots = 0;
const rnd = (() => { let s = 42; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
for (let i = 0; i < 6 && a.view.phase === 'playing'; i++) {
  const p = whose();
  const seq = a.view.shotSeq;
  const ang = (rnd() - 0.5) * 0.6 + (i % 2 ? Math.PI : 0.03);
  const cue = a.view.match.inHand !== 'none' ? { x: -0.4, y: 0 } : undefined;
  p.send({ t: 'shot', dx: Math.cos(ang), dy: Math.sin(ang), v: 2 + rnd() * 3.5, a: 0, b: 0.1, cue });
  await a.until(() => a.view.shotSeq > seq && b.view.shotSeq > seq, 20000, `resultado da tacada ${i + 1}`);
  shots++;
}
log(`${shots} tacadas resolvidas`);
if (a.shots.length !== b.shots.length) fail('os dois deveriam receber os mesmos eventos de tacada');
const last = a.shots[a.shots.length - 1];
if (JSON.stringify(a.view.match.balls) !== JSON.stringify(b.view.match.balls)) fail('estado das bolas difere entre os clientes');
if (!last.start || last.start.length !== 16) fail('evento de tacada sem posições iniciais');
log('estados idênticos nos dois clientes; evento de tacada completo');

// 6) reconexão no meio da partida
const bSeq = b.view.shotSeq;
b.ws.close();
await sleep(400);
const b2 = new Client(code, 'player-bbbbbbbb-0002', 'Beto');
await b2.ready;
await b2.until(() => b2.view && b2.view.phase === 'playing' && b2.view.shotSeq === bSeq, 8000, 'reconexão com estado');
log('reconexão ok (estado restaurado)');

// 6b) mira completa: um liga, vale para os dois e os dois são avisados; desligar também
if (a.view.assist || b2.view.assist) fail('mira completa deveria começar desligada');
a.send({ t: 'assist', on: true });
await a.until(() => a.view.assist === true && b2.view.assist === true, 5000, 'mira completa ligada para os dois');
await b2.until(() => b2.notices.some((t) => t.includes('mira completa')), 5000, 'aviso ao adversário');
a.send({ t: 'assist', on: false });
await a.until(() => a.view.assist === false && b2.view.assist === false, 5000, 'mira completa desligada para os dois');
log('mira completa: ligar vale para os dois (com aviso) e desligar também');

// 7) bot: sala nova com bot
const r2 = await api('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'bola61', turnSeconds: 0 }) });
const solo = new Client(r2.code, 'player-dddddddd-0004', 'Duda');
await solo.ready;
await solo.until(() => solo.view?.players.length === 1, 5000, 'Duda no saguão');
solo.send({ t: 'bot', on: true, level: 'facil' });
await solo.until(() => solo.view.players.length === 2, 5000, 'bot na sala');
solo.send({ t: 'start' });
await solo.until(() => solo.view.phase === 'playing', 5000, 'início contra bot');
let tries = 0;
while (solo.shots.length < 3 && tries++ < 40) {
  const m = solo.view.match;
  const me = solo.view.players.find((p) => p.id === solo.view.you);
  if (m.turn === me.seat && !solo.view.last?.over) {
    const n = solo.shots.length;
    solo.send({ t: 'shot', dx: 1, dy: 0.02, v: 3, a: 0, b: 0, cue: m.inHand !== 'none' ? { x: -0.4, y: 0 } : undefined });
    await solo.until(() => solo.shots.length > n, 15000, 'minha tacada');
  } else await sleep(500);
}
await solo.until(() => solo.shots.some((s) => solo.view.players.find((p) => p.seat === s.by)?.bot), 30000, 'jogada do bot');
log('bot jogou sozinho (alarme do servidor funcionando)');

// 7b) contra bot Difícil/Mestre a mira completa é proibida
const rDif = await api('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'bola61', turnSeconds: 0 }) });
const dif = new Client(rDif.code, 'player-eeeeeeee-0005', 'Edu');
await dif.ready;
await dif.until(() => dif.view?.players.length === 1, 5000, 'Edu no saguão');
dif.send({ t: 'bot', on: true, level: 'dificil' });
await dif.until(() => dif.view.players.length === 2, 5000, 'bot difícil na sala');
dif.send({ t: 'assist', on: true });
await dif.until(() => dif.errors.some((e) => e.includes('Difícil')), 5000, 'recusa da mira completa contra bot difícil');
if (dif.view.assist) fail('mira completa não pode ligar contra bot difícil');
log('mira completa recusada contra bot Difícil');

// 8) ranking acessível e nome reservado
const rk = await api('/api/ranking');
log('ranking:', rk.length, 'jogadores');
const cl1 = await api('/api/name/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'player-aaaaaaaa-0001', name: 'Ana' }) });
const r3 = await fetch(BASE + '/api/name/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'player-zzzzzzzz-9999', name: 'ana' }) });
if (!cl1.ok || r3.status !== 409) fail('reserva de nome');
log('reserva de nome ok');

// 9) abandono encerra a partida
a.send({ t: 'leave' });
await b2.until(() => b2.view.phase === 'ended' && b2.view.result?.forfeit, 8000, 'fim por abandono');
log('abandono encerra a partida:', b2.view.result.reason);

console.log('\n✓ tudo certo');
process.exit(0);
