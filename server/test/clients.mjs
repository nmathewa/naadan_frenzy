// End-to-end test: three simulated players against a running server.
//
//   npm run dev:test                       (in another terminal)
//   npm test                               (or: node test/clients.mjs ws://host:port)
//
// Covers joining and refusals, the 3-player cap, start/play, inputs and acks,
// events routed to one player or all, the say relay, reconnecting, the leader
// leaving, and grace-period expiry. Reports snapshot rate and size.
import WebSocket from 'ws';

const BASE = process.argv[2] || 'ws://localhost:8787';
const V = '1';
const GRACE_MS = 3000; // must match the server's GRACE_MS for the expiry check
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failures = 0, passes = 0;
function check(ok, label, extra = '') {
  if (ok) { passes++; console.log('  ok   ' + label); }
  else { failures++; console.log('  FAIL ' + label + (extra ? '  ' + extra : '')); }
}

function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

/** A test client that records every frame it receives. */
function client(code, { name = 'P', pid = 'pid-' + Math.random().toString(36).slice(2), create = false, v = V } = {}) {
  const url = `${BASE}/ws/${code}?name=${encodeURIComponent(name)}&pid=${pid}&v=${v}${create ? '&create=1' : ''}`;
  const ws = new WebSocket(url);
  const c = { ws, pid, name, frames: [], snaps: [], events: [], closed: null, seq: 0 };
  ws.on('message', d => {
    const s = d.toString();
    const f = JSON.parse(s);
    f._len = s.length; f._at = Date.now();
    c.frames.push(f);
    if (f.t === 's') { c.snaps.push(f); c.events.push(...f.ev); }
  });
  ws.on('close', (code, reason) => { c.closed = { code, reason: reason.toString() }; });
  c.open = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  c.send = m => ws.send(JSON.stringify(m));
  c.input = m => { c.seq += 1; c.send({ ...m, seq: c.seq }); return c.seq; };
  c.last = t => [...c.frames].reverse().find(f => f.t === t);
  c.snap = () => c.snaps[c.snaps.length - 1];
  c.wait = async (pred, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const f = c.frames.find(pred); if (f) return f; await sleep(20); }
    return null;
  };
  c.close = () => new Promise(res => { if (c.closed) return res(); ws.once('close', res); ws.close(); });
  return c;
}

async function refused(code, opts, expect) {
  const c = client(code, opts);
  const f = await c.wait(f => f.t === 'error');
  await sleep(100);
  check(f && f.code === expect, `refused with '${expect}'`, JSON.stringify(f));
  if (!c.closed) c.ws.terminate();
}

async function main() {
  const code = randomCode();
  console.log(`server ${BASE}, farm ${code}`);

  console.log('joining');
  await refused('O0O0', {}, 'badcode');
  await refused(code, { v: '999' }, 'version');
  await refused(code, {}, 'nofarm');

  const a = client(code, { name: 'Anu', create: true });
  const ra = await a.wait(f => f.t === 'room');
  check(ra && ra.you === 'p1' && ra.leader === 'p1' && ra.players.length === 1, 'creator is p1 and leader');
  await refused(code, { create: true }, 'taken');

  const b = client(code, { name: 'Biju' });
  const c = client(code, { name: 'Chinnu' });
  await b.wait(f => f.t === 'room'); await c.wait(f => f.t === 'room');
  await sleep(200);
  const room3 = a.last('room');
  check(room3.players.length === 3, 'three players in the room');
  check(new Set(room3.players.map(p => p.color)).size === 3, 'each player has their own colour');
  check(b.last('room').you !== c.last('room').you, 'b and c get different ids');
  await refused(code, {}, 'full');

  console.log('starting a level');
  b.send({ t: 'start', li: 0 });
  await sleep(300);
  check(!a.frames.some(f => f.t === 'start'), 'a non-leader cannot start');
  a.send({ t: 'start', li: 0, up: { well: 1, store: 9, bogus: 3 }, nights: false });
  const starts = await Promise.all([a, b, c].map(x => x.wait(f => f.t === 'start')));
  check(starts.every(s => s && s.li === 0), 'everyone gets the start frame');
  check(starts[0] && starts[0].opts.up.store === 3 && !('bogus' in starts[0].opts.up), 'upgrades are clamped');
  await c.wait(f => f.t === 's');
  check(c.snap() && c.snap().st === 'intro', 'snapshots arrive in the intro state');

  b.send({ t: 'play' });
  await sleep(300);
  check(a.snap().st === 'intro', 'a non-leader cannot press play');
  a.send({ t: 'play' });
  await a.wait(f => f.t === 's' && f.st === 'play');
  check(a.snap().st === 'play', 'leader starts play');

  console.log('inputs, acks and events');
  const m0 = a.snap().m;
  a.events.length = b.events.length = c.events.length = 0;
  const s1 = b.input({ t: 'buy', k: 'hen' });
  await b.wait(f => f.t === 's' && f.ack >= s1);
  await sleep(200);
  check(a.snap().m === m0 - 100, `b buys a hen and a sees the money drop (${m0} -> ${a.snap().m})`);
  check([a, b, c].every(x => x.events.some(e => e.s === 'buy')), 'the buy sound goes to everyone');
  check(b.snap().ack === s1 && a.snap().ack === 0, 'b gets its own ack, a does not');

  b.input({ t: 'buy', k: 'hen' }); // cannot afford the second one
  await sleep(300);
  const toast = e => e.toast && /costs/.test(e.toast);
  check(b.events.some(toast), 'b sees the "costs" warning');
  check(!a.events.some(toast) && !c.events.some(toast), 'a and c do not see b\'s warning');

  const w0 = c.snap().w;
  for (let i = 0; i < 14; i++) c.input({ t: 'tap', x: 44 + (i % 12) * 28, y: 174 + 62 * Math.floor(i / 12), tool: 'hand' });
  await sleep(400);
  check(a.snap().w < w0, `c waters the field and a sees the well level drop (${w0} -> ${a.snap().w})`);
  const noWater = e => e.toast && /No water/.test(e.toast);
  check(c.events.some(noWater) && !a.events.some(noWater) && !b.events.some(noWater), 'only c sees "No water left"');

  a.send({ t: 'tap', x: 'x', y: null }); a.send({ t: 'nonsense' }); a.ws.send('not json');
  await sleep(200);
  check(a.snap().st === 'play', 'garbage frames are ignored');

  console.log('say relay');
  const before = [a, b, c].map(x => x.frames.filter(f => f.t === 'say').length);
  a.send({ t: 'say', id: 'punch' }); a.send({ t: 'say', id: 'punch' });
  await sleep(300);
  const after = [a, b, c].map(x => x.frames.filter(f => f.t === 'say').length);
  check(after[0] === before[0] && after[1] === before[1] + 1 && after[2] === before[2] + 1,
    'say reaches the others once (rate limited), not the sender', JSON.stringify({ before, after }));

  console.log('snapshot rate');
  const n0 = a.snaps.length, t0 = Date.now();
  await sleep(3000);
  const recent = a.snaps.slice(n0);
  const hz = recent.length / ((Date.now() - t0) / 1000);
  const sizes = recent.map(s => s._len);
  const avg = sizes.reduce((x, y) => x + y, 0) / sizes.length;
  let maxGap = 0;
  for (let i = 1; i < recent.length; i++) maxGap = Math.max(maxGap, recent[i]._at - recent[i - 1]._at);
  console.log(`  ${hz.toFixed(1)} snapshots/s, avg ${Math.round(avg)} bytes, max ${Math.max(...sizes)} bytes, max gap ${maxGap} ms`);
  check(hz > 10 && hz < 14, 'about 12 snapshots per second');
  const gt0 = recent[0].gt, gt1 = recent[recent.length - 1].gt;
  console.log(`  game time ${gt0} -> ${gt1} over ${((recent[recent.length - 1]._at - recent[0]._at) / 1000).toFixed(2)} s real`);

  console.log('reconnecting');
  const bId = b.last('room').you;
  await b.close();
  await sleep(300);
  check(a.last('room').players.find(p => p.id === bId).online === false, 'a sees b go offline');
  const b2 = client(code, { name: 'Biju', pid: b.pid });
  const rb = await b2.wait(f => f.t === 'room');
  check(rb && rb.you === bId, 'b gets the same id back');
  check(!!(await b2.wait(f => f.t === 'start')), 'b gets the start frame again');
  check(!!(await b2.wait(f => f.t === 's')), 'b gets snapshots again');
  const s2 = b2.input({ t: 'tap', x: 210, y: 590, tool: 'hand' });
  check(!!(await b2.wait(f => f.t === 's' && f.ack >= s2)), 'b\'s inputs are acked after reconnecting');

  console.log('leader leaves, grace expiry');
  a.send({ t: 'leave' });
  await sleep(300);
  const rl = b2.last('room');
  check(rl.players.length === 2 && rl.leader === bId, 'b becomes leader when a leaves');
  check(!!a.closed, 'a\'s socket is closed after leaving');

  const cId = c.last('room').you;
  c.ws.terminate();
  await sleep(GRACE_MS + 1500);
  const rg = b2.last('room');
  check(!rg.players.some(p => p.id === cId), 'c is dropped after the grace period', JSON.stringify(rg.players));

  b2.send({ t: 'map' });
  await sleep(300);
  check(b2.last('room').phase === 'lobby', 'the leader returns everyone to the map');
  const nSnap = b2.snaps.length;
  await sleep(500);
  check(b2.snaps.length === nSnap, 'snapshots stop on the map');

  console.log('starting another level');
  b2.send({ t: 'start', li: 0 });
  await b2.wait(f => f.t === 's' && f.st === 'intro');
  b2.send({ t: 'play' });
  await b2.wait(f => f.t === 's' && f.st === 'play');
  check(b2.snap().m === 150, 'a fresh level starts with fresh money');

  const d = client(code, { name: 'Dev' });
  check(!!(await d.wait(f => f.t === 'start')), 'a friend joining mid-level gets the start frame');
  await d.wait(f => f.t === 's');
  const m1 = b2.snap().m;
  const sd = d.input({ t: 'buy', k: 'hen' });
  await d.wait(f => f.t === 's' && f.ack >= sd);
  await sleep(200);
  check(b2.snap().m === m1 - 100, 'and can play straight away');

  b2.send({ t: 'start', li: 1 });
  const restarted = await d.wait(f => f.t === 'start' && f.li === 1);
  check(!!restarted, 'the leader can switch level mid-game');
  await d.close();

  await b2.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
