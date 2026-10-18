/*
 * room.js — the Room Durable Object: one instance per 4-letter farm code.
 *
 * Responsibilities
 *   - Membership: up to 3 players, colour by join slot, leader = earliest joiner.
 *     A disconnected player keeps their slot for GRACE_MS (60 s) and gets it
 *     back by reconnecting with the same `pid`; after that they are dropped.
 *   - Running the authoritative simulation: game.step(0.05) at 20 Hz and a
 *     per-player snapshot frame at 12 Hz while a level is on.
 *   - Relaying meme-sound reactions ({t:'say'}).
 *
 * Lifecycle / cost
 *   - Sockets use the WebSocket Hibernation API (ctx.acceptWebSocket), so in the
 *     lobby, or after a level has ended, the object can be evicted from memory
 *     while clients stay connected. The membership roster is persisted to
 *     storage so it survives that; the in-memory game does not need to, because
 *     the 20 Hz interval keeps the object awake for as long as a level runs.
 *   - The loop is stopped when a level ends (after a 2 s tail), when the
 *     leader returns to the map, and when the room empties. While every player
 *     is offline (inside their reconnect window) the level is paused but the
 *     timer keeps ticking, so the in-memory game is not evicted.
 *   - Drops after the grace period are driven by a storage alarm, which works
 *     whether or not the object is in memory.
 */
import { DurableObject } from 'cloudflare:workers';
import { Core } from './engine.js';
import {
  MAX_PLAYERS, COLORS, INPUT_TYPES,
  sanitizeName, sanitizePid, sanitizeUpgrades, errorFrame,
} from './protocol.js';

const TICK_MS = 50;              // simulation step interval (20 Hz)
const STEP_DT = TICK_MS / 1000;  // seconds passed to game.step()
const SNAP_MS = 1000 / 12;       // snapshot interval (12 Hz)
const MAX_CATCHUP_MS = 250;      // never simulate more than this after a stall
const END_TAIL_MS = 2000;        // keep streaming snapshots this long after won/failed
const DEFAULT_GRACE_MS = 60000;  // reconnect window for a dropped player
const MAX_FRAME_CHARS = 4096;    // ignore client frames larger than this
const MAX_QUEUED_EVENTS = 256;   // per player, between two snapshots
const MAX_INPUTS_PER_SEC = 30;   // per player
const SAY_INTERVAL_MS = 1000;    // meme-sound rate limit per player
const MAX_TICK_ERRORS = 20;      // consecutive engine errors before the level is abandoned
const ENDED_STATES = new Set(['won', 'done', 'failed', 'over']);
const STORAGE_KEY = 'room';

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.graceMs = Number(env.GRACE_MS) > 0 ? Number(env.GRACE_MS) : DEFAULT_GRACE_MS;
    this.resetState();
    // Rebuild the roster after a hibernation wake-up or restart before any event runs.
    ctx.blockConcurrencyWhile(() => this.restore());
  }

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */

  resetState() {
    this.code = null;
    /** pid -> member. Member = {pid,id,name,slot,order,ws,offlineSince,ack,events,lastSay,inWindow,inCount} */
    this.members = new Map();
    this.nextOrder = 0;      // join counter; player ids are 'p' + order
    this.phase = 'lobby';    // 'lobby' | 'game'
    this.li = 0;             // last started level
    this.opts = null;        // {nights, up} of the current/last level
    this.game = null;        // engine instance while a level is running or in its end tail
    this.inGame = new Set(); // player ids taking part in this.game
    this.ended = null;       // {result, snap} once the current level has ended
    this.endedAt = 0;        // Date.now() when the level ended (0 = still running)
    this.timer = null;       // setInterval handle
    this.lastTick = 0;
    this.stepAcc = 0;
    this.snapAcc = 0;
    this.tickErrors = 0;
    this.lastSnapJson = null;
  }

  newMember(pid, name, slot) {
    this.nextOrder += 1;
    return { pid, name, slot, id: 'p' + this.nextOrder, order: this.nextOrder, ...transientFields() };
  }

  async restore() {
    const saved = await this.ctx.storage.get(STORAGE_KEY);
    if (!saved) return;
    this.code = saved.code;
    this.nextOrder = saved.nextOrder;
    this.phase = saved.phase;
    this.li = saved.li;
    this.opts = saved.opts;
    this.ended = saved.ended;
    for (const s of saved.members) {
      this.members.set(s.pid, { ...transientFields(), ...s, ws: null });
    }
    // Re-attach live hibernated sockets to their members.
    for (const ws of this.ctx.getWebSockets()) {
      const pid = attachedPid(ws);
      const m = pid && this.members.get(pid);
      if (m && !m.ws) m.ws = ws; else safeClose(ws, 4001, 'stale');
    }
    const now = Date.now();
    for (const m of this.members.values()) {
      if (m.ws) m.offlineSince = null;
      else if (m.offlineSince == null) m.offlineSince = now;
    }
    // A level that was still running cannot be recovered (the object restarted).
    if (this.phase === 'game' && !this.ended) this.phase = 'lobby';
    if (this.members.size === 0) { await this.clearRoom(); return; }
    await this.persist();
    await this.scheduleAlarm();
  }

  /** Save everything needed to rebuild the room after hibernation. */
  async persist() {
    await this.ctx.storage.put(STORAGE_KEY, {
      code: this.code,
      nextOrder: this.nextOrder,
      phase: this.phase,
      li: this.li,
      opts: this.opts,
      ended: this.ended,
      members: [...this.members.values()].map(m => ({
        pid: m.pid, id: m.id, name: m.name, slot: m.slot, order: m.order, offlineSince: m.offlineSince,
      })),
    });
  }

  async clearRoom() {
    this.stopLoop();
    for (const m of this.members.values()) if (m.ws) safeClose(m.ws, 1000, 'closed');
    this.resetState();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /* ------------------------------------------------------------------ */
  /* Membership helpers                                                  */
  /* ------------------------------------------------------------------ */

  /** Members in join order. */
  roster() {
    return [...this.members.values()].sort((a, b) => a.order - b.order);
  }

  online() {
    return this.roster().filter(m => m.ws);
  }

  leader() {
    return this.roster()[0] || null;
  }

  memberById(id) {
    for (const m of this.members.values()) if (m.id === id) return m;
    return null;
  }

  /** The member owning this socket, or null if the socket is stale/replaced. */
  memberFor(ws) {
    const pid = attachedPid(ws);
    const m = pid && this.members.get(pid);
    return m && m.ws === ws ? m : null;
  }

  freeSlot() {
    const used = new Set([...this.members.values()].map(m => m.slot));
    for (let s = 0; s < MAX_PLAYERS; s++) if (!used.has(s)) return s;
    return -1;
  }

  roomFrame(forMember) {
    const leader = this.leader();
    return JSON.stringify({
      t: 'room',
      code: this.code,
      you: forMember.id,
      leader: leader ? leader.id : null,
      phase: this.phase,
      li: this.li,
      players: this.roster().map(m => ({ id: m.id, name: m.name, color: COLORS[m.slot], online: !!m.ws })),
    });
  }

  broadcastRoom() {
    for (const m of this.online()) send(m.ws, this.roomFrame(m));
  }

  broadcast(frame, except = null) {
    for (const m of this.online()) if (m !== except) send(m.ws, frame);
  }

  startFrame() {
    return JSON.stringify({ t: 'start', li: this.li, opts: this.opts });
  }

  /* ------------------------------------------------------------------ */
  /* Connecting                                                          */
  /* ------------------------------------------------------------------ */

  async fetch(request) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const url = new URL(request.url);
    const code = request.headers.get('X-Room-Code');
    const pid = sanitizePid(url.searchParams.get('pid'));
    const name = sanitizeName(url.searchParams.get('name'));
    const create = url.searchParams.get('create') === '1';

    const [client, server] = Object.values(new WebSocketPair());
    const refusal = await this.admit(code, pid, name, create);
    if (refusal) {
      // Not a member: a plain (non-hibernating) socket just to deliver the reason.
      server.accept();
      server.send(errorFrame(refusal.code, refusal.msg));
      server.close(4000, refusal.code);
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid });
    await this.connect(this.members.get(pid), server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Decide whether pid may join, creating its member entry if needed.
   * Returns null on success or {code,msg} to refuse.
   */
  async admit(code, pid, name, create) {
    const existing = this.members.get(pid);
    if (existing) {
      // Reconnect (or a second tab/network for the same client): take the slot back.
      existing.name = name;
      if (existing.ws) {
        const old = existing.ws;
        existing.ws = null;
        safeClose(old, 4001, 'replaced');
      }
      return null;
    }

    if (create) {
      if (this.online().length > 0) return { code: 'taken', msg: 'That farm code is already in use.' };
      // Nobody is online: whatever was here before is abandoned; start fresh.
      if (this.members.size > 0) await this.clearRoom();
      this.code = code;
    } else if (this.members.size === 0) {
      return { code: 'nofarm', msg: 'No farm with that code. Check the code with your friend.' };
    }

    const slot = this.freeSlot();
    if (slot < 0) return { code: 'full', msg: 'This farm already has 3 players.' };
    this.code = this.code || code;
    this.members.set(pid, this.newMember(pid, name, slot));
    return null;
  }

  /** Attach a socket to a member and bring the client up to date. */
  async connect(m, ws) {
    m.ws = ws;
    m.offlineSince = null;
    m.ack = 0;
    m.events = [];
    m.lastSay = 0;
    await this.persist();
    await this.scheduleAlarm();
    this.broadcastRoom();

    if (this.phase !== 'game') return;
    if (this.game) this.inGame.add(m.id); // a friend joining mid-level plays straight away
    send(ws, this.startFrame());
    if (this.game) {
      // Level running (or in its end tail): snapshots resume on the next tick.
      if (this.ended) send(ws, JSON.stringify({ t: 'end', result: this.ended.result }));
    } else if (this.ended) {
      // Level over and the loop is quiet: show the final frame and the result.
      if (this.ended.snap) send(ws, snapshotFrame(this.ended.snap, '[]', 0));
      send(ws, JSON.stringify({ t: 'end', result: this.ended.result }));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Disconnecting                                                       */
  /* ------------------------------------------------------------------ */

  async webSocketClose(ws) {
    safeClose(ws, 1000, 'bye');
    await this.markOffline(ws);
  }

  async webSocketError(ws) {
    await this.markOffline(ws);
  }

  async markOffline(ws) {
    const m = this.memberFor(ws);
    if (!m) return; // stale socket (replaced or already removed)
    m.ws = null;
    m.offlineSince = Date.now();
    m.events = [];
    await this.persist();
    await this.scheduleAlarm();
    this.broadcastRoom();
  }

  /** Remove members for good (explicit leave or grace expiry). */
  async removeMembers(list) {
    for (const m of list) {
      this.members.delete(m.pid);
      if (m.ws) safeClose(m.ws, 1000, 'left');
    }
    if (this.members.size === 0) { await this.clearRoom(); return; }
    await this.persist();
    await this.scheduleAlarm();
    this.broadcastRoom();
  }

  async scheduleAlarm() {
    let earliest = Infinity;
    for (const m of this.members.values()) {
      if (m.offlineSince != null) earliest = Math.min(earliest, m.offlineSince + this.graceMs);
    }
    if (earliest === Infinity) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(earliest);
  }

  async alarm() {
    const now = Date.now();
    const expired = [...this.members.values()].filter(
      m => !m.ws && m.offlineSince != null && now - m.offlineSince >= this.graceMs);
    if (expired.length) await this.removeMembers(expired);
    else await this.scheduleAlarm();
  }

  /* ------------------------------------------------------------------ */
  /* Messages                                                            */
  /* ------------------------------------------------------------------ */

  async webSocketMessage(ws, data) {
    // Guard everything: one bad frame must never take the room down.
    if (typeof data !== 'string' || data.length > MAX_FRAME_CHARS) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return;
    const m = this.memberFor(ws);
    if (!m) return;
    try {
      await this.handle(m, msg);
    } catch (err) {
      console.error(`room ${this.code}: error handling '${msg.t}' from ${m.id}:`, err && err.stack || err);
    }
  }

  async handle(m, msg) {
    const isLeader = this.leader() === m;

    if (INPUT_TYPES.has(msg.t)) { this.handleInput(m, msg); return; }

    switch (msg.t) {
      case 'ping': {
        const c = typeof msg.c === 'number' || (typeof msg.c === 'string' && msg.c.length <= 64) ? msg.c : null;
        send(m.ws, JSON.stringify({ t: 'pong', c }));
        return;
      }
      case 'say': {
        const id = msg.id;
        const ok = (typeof id === 'string' && id.length > 0 && id.length <= 32) || Number.isFinite(id);
        const now = Date.now();
        if (!ok || now - m.lastSay < SAY_INTERVAL_MS) return;
        m.lastSay = now;
        this.broadcast(JSON.stringify({ t: 'say', id, from: m.id }), m);
        return;
      }
      case 'leave':
        await this.removeMembers([m]);
        return;
      case 'start':
        if (!isLeader) return;
        await this.startLevel(msg); // also restarts a running level (Restart in the pause menu)
        return;
      case 'play':
        if (!isLeader || !this.game || this.game.state !== 'intro') return;
        this.game.start();
        return;
      case 'map':
        if (!isLeader || this.phase !== 'game') return;
        this.stopLoop();
        this.game = null;
        this.ended = null;
        this.endedAt = 0;
        this.phase = 'lobby';
        await this.persist();
        this.broadcastRoom();
        return;
      default:
        return; // unknown message types are ignored
    }
  }

  handleInput(m, msg) {
    if (this.phase !== 'game' || !this.game || !this.inGame.has(m.id)) return;
    // Simple per-player flood guard.
    const now = Date.now();
    if (now - m.inWindow >= 1000) { m.inWindow = now; m.inCount = 0; }
    if (++m.inCount > MAX_INPUTS_PER_SEC) return;
    // Ack every received input, accepted or not, so clients can clear pending state.
    if (Number.isFinite(msg.seq) && msg.seq > m.ack) m.ack = msg.seq;
    if (this.game.state !== 'play') return;
    this.game.input(m.id, msg);
  }

  /* ------------------------------------------------------------------ */
  /* Levels and the game loop                                            */
  /* ------------------------------------------------------------------ */

  async startLevel(msg) {
    const li = msg.li;
    if (!Number.isInteger(li) || li < 0 || li >= Core.LEVEL_COUNT) return;
    const up = sanitizeUpgrades(msg.up);
    const nights = msg.nights !== false;
    const players = this.online().map(m => ({ id: m.id, name: m.name, color: COLORS[m.slot], slot: m.slot }));

    for (const m of this.members.values()) { m.events = []; m.ack = 0; }
    let game;
    try {
      game = Core.createGame({
        level: li,
        players,
        up,
        nights,
        hooks: { event: (e, to) => this.queueEvent(e, to) },
      });
    } catch (err) {
      console.error(`room ${this.code}: createGame failed:`, err && err.stack || err);
      return;
    }

    this.stopLoop();
    this.game = game;
    this.inGame = new Set(players.map(p => p.id));
    this.phase = 'game';
    this.li = li;
    this.opts = { nights, up };
    this.ended = null;
    this.endedAt = 0;
    this.tickErrors = 0;

    await this.persist();
    this.broadcastRoom();
    this.broadcast(this.startFrame());
    this.startLoop();
  }

  /** hooks.event from the engine. toPlayerId null => everyone. */
  queueEvent(e, toPlayerId) {
    const targets = toPlayerId == null ? this.online() : [this.memberById(toPlayerId)];
    for (const m of targets) {
      if (!m || !m.ws) continue;
      if (m.events.length >= MAX_QUEUED_EVENTS) m.events.shift();
      m.events.push(e);
    }
  }

  startLoop() {
    if (this.timer || !this.game) return;
    this.lastTick = Date.now();
    this.stepAcc = 0;
    this.snapAcc = SNAP_MS; // send a frame on the first tick
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stopLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    const game = this.game;
    if (!game) { this.stopLoop(); return; }
    const now = Date.now();
    const elapsed = Math.min(MAX_CATCHUP_MS, Math.max(0, now - this.lastTick));
    this.lastTick = now;

    if (this.endedAt && now - this.endedAt >= END_TAIL_MS) { this.finishTail(); return; }

    // Nobody online (all within their reconnect window): pause the level. The
    // timer keeps running so the object, and the game in memory, stay alive.
    if (this.online().length === 0) return;

    try {
      // Fixed-timestep simulation: always step(0.05), as many times as real time requires.
      this.stepAcc += elapsed;
      while (this.stepAcc >= TICK_MS) {
        this.stepAcc -= TICK_MS;
        game.step(STEP_DT);
      }

      if (!this.endedAt && ENDED_STATES.has(game.state)) this.onLevelEnded(now);

      this.snapAcc += elapsed;
      if (this.snapAcc >= SNAP_MS) {
        this.snapAcc = Math.min(this.snapAcc - SNAP_MS, SNAP_MS);
        this.sendSnapshots();
      }
      this.tickErrors = 0;
    } catch (err) {
      console.error(`room ${this.code}: tick failed:`, err && err.stack || err);
      if (++this.tickErrors >= MAX_TICK_ERRORS) this.abandonLevel();
    }
  }

  sendSnapshots() {
    const json = JSON.stringify(this.game.snapshot());
    if (typeof json !== 'string' || json[0] !== '{') return;
    this.lastSnapJson = json;
    for (const m of this.online()) {
      let ev = '[]';
      if (m.events.length) {
        try { ev = JSON.stringify(m.events); } catch { ev = '[]'; }
        m.events = [];
      }
      send(m.ws, snapshotFrame(json, ev, m.ack));
    }
  }

  onLevelEnded(now) {
    this.endedAt = now;
    let result = null;
    try { result = this.game.result(); } catch (err) { console.error('result() failed', err); }
    this.ended = { result, snap: null };
    this.broadcast(JSON.stringify({ t: 'end', result }));
  }

  /** The 2 s tail after the end is over: stop the loop and go quiet. */
  finishTail() {
    this.stopLoop();
    this.ended = { result: this.ended && this.ended.result, snap: this.lastSnapJson };
    this.game = null;
    this.inGame = new Set();
    this.persistInBackground();
  }

  /** The engine keeps throwing: give up on this level and return everyone to the map. */
  abandonLevel() {
    console.error(`room ${this.code}: abandoning level ${this.li} after repeated engine errors`);
    this.stopLoop();
    this.game = null;
    this.ended = null;
    this.endedAt = 0;
    this.phase = 'lobby';
    this.persistInBackground();
    this.broadcastRoom();
  }

  /** persist() from a timer callback, where there is nobody to await it. */
  persistInBackground() {
    this.persist().catch(err => console.error(`room ${this.code}: persist failed:`, err));
  }
}

/* -------------------------------------------------------------------- */
/* Small helpers                                                         */
/* -------------------------------------------------------------------- */

/**
 * Build {t:'s', ...snapshot, ev, ack} by splicing into the snapshot JSON that
 * was serialised once for everyone. Our keys go last so they win over any
 * same-named snapshot keys.
 */
function snapshotFrame(snapJson, evJson, ack) {
  const head = snapJson.length > 2 ? snapJson.slice(0, -1) + ',' : '{';
  return head + '"ev":' + evJson + ',"ack":' + ack + ',"t":"s"}';
}

/** Per-connection member fields that are never persisted. */
function transientFields() {
  return {
    ws: null,
    offlineSince: null,
    ack: 0,        // highest input seq received on the current connection
    events: [],    // engine events queued for this player's next snapshot
    lastSay: 0,
    inWindow: 0,   // input rate-limit window start (ms)
    inCount: 0,
  };
}

function attachedPid(ws) {
  try {
    const a = ws.deserializeAttachment();
    return a && typeof a.pid === 'string' ? a.pid : null;
  } catch {
    return null;
  }
}

function send(ws, frame) {
  try { ws.send(frame); } catch { /* socket already closing; close handler cleans up */ }
}

function safeClose(ws, code, reason) {
  try { ws.close(code, reason); } catch { /* already closed */ }
}
