/*
 * mock-core.js — a tiny stand-in for the real Naadan Frenzy engine (../../core.js).
 *
 * It implements exactly the engine interface the server relies on, so the
 * server can be developed and tested before the real rules are extracted from
 * index.html. Like the real core.js it is a classic script: evaluating it sets
 * globalThis.NaadanCore and exports nothing.
 *
 * Behaviour (deliberately simple and deterministic so tests can assert on it):
 *   - 40 "dots" bounce around the 420x640 world (gives the snapshot some bulk).
 *   - Every {t:'tap'} adds 10 to the shared money and 1 to that player's taps.
 *     It emits {s:'cash'} to everyone and {toast:'Nice tap, <name>'} to the tapper.
 *   - {t:'buy',k} costs 5 money and emits {s:'buy',k} to everyone.
 *   - After goalTaps total taps (9 + 3*level) the state becomes 'won', then
 *     'done' 1.2 s later (mirrors index.html). After 300 s of play: 'failed' -> 'over'.
 */
(function () {
  'use strict';

  var W = 420, H = 640;
  var LEVEL_COUNT = 5;
  var VERSION = 'mock-1';
  var DOT_COUNT = 40;
  var TIME_LIMIT = 300;

  function round1(v) { return Math.round(v * 10) / 10; }

  function createGame(opts) {
    var level = opts.level | 0;
    var hooks = opts.hooks || {};
    var emit = function (e, to) {
      if (typeof hooks.event === 'function') hooks.event(e, to == null ? null : to);
    };

    var players = opts.players.map(function (p, i) {
      return { id: p.id, name: p.name, color: p.color || null, x: 100 + i * 110, y: 520, taps: 0, tool: 'net' };
    });
    var byId = {};
    players.forEach(function (p) { byId[p.id] = p; });

    // Deterministic pseudo-random dots.
    var seed = 12345 + level;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var dots = [];
    for (var i = 0; i < DOT_COUNT; i++) {
      dots.push({ x: rnd() * W, y: rnd() * H, vx: (rnd() - 0.5) * 80, vy: (rnd() - 0.5) * 80 });
    }

    var g = {
      state: 'intro',
      level: level,
      t: 0,        // seconds of play
      endT: 0,     // seconds since won/failed
      money: 100,
      taps: 0,
      goalTaps: 9 + 3 * level,
      up: opts.up || {},
      nights: !!opts.nights,
      reason: '',
      fxTimer: 0
    };

    function finish(won, reason) {
      g.state = won ? 'won' : 'failed';
      g.reason = reason;
      g.endT = 0;
      emit({ s: won ? 'win' : 'fail' }, null);
    }

    return {
      get state() { return g.state; },

      start: function () {
        if (g.state === 'intro') { g.state = 'play'; emit({ s: 'go' }, null); }
      },

      step: function (dt) {
        for (var i = 0; i < dots.length; i++) {
          var d = dots[i];
          d.x += d.vx * dt; d.y += d.vy * dt;
          if (d.x < 0 || d.x > W) d.vx = -d.vx;
          if (d.y < 0 || d.y > H) d.vy = -d.vy;
        }
        if (g.state === 'play') {
          g.t += dt;
          g.fxTimer += dt;
          if (g.fxTimer >= 5) { g.fxTimer = 0; emit({ fx: ['sparkle', 210, 320] }, null); }
          if (g.t >= TIME_LIMIT) finish(false, 'time');
        } else if (g.state === 'won' || g.state === 'failed') {
          g.endT += dt;
          if (g.endT > 1.2) g.state = g.state === 'won' ? 'done' : 'over';
        }
      },

      input: function (playerId, msg) {
        if (g.state !== 'play') return;
        var p = byId[playerId];
        if (!p || !msg) return;
        switch (msg.t) {
          case 'tap':
            p.taps++; g.taps++; g.money += 10;
            if (typeof msg.x === 'number') p.x = msg.x;
            if (typeof msg.y === 'number') p.y = msg.y;
            if (msg.tool === 'net' || msg.tool === 'stick') p.tool = msg.tool;
            emit({ s: 'cash' }, null);
            emit({ toast: 'Nice tap, ' + p.name }, playerId);
            if (g.taps >= g.goalTaps) finish(true, 'goal');
            break;
          case 'buy':
            if (g.money >= 5) { g.money -= 5; emit({ s: 'buy', k: msg.k }, null); }
            break;
          default:
            // mk / go / upauto / upstore: accepted but no effect in the mock.
            break;
        }
      },

      snapshot: function () {
        return {
          lv: g.level,
          st: g.state,
          t: round1(g.t),
          money: g.money,
          taps: g.taps,
          goal: g.goalTaps,
          players: players.map(function (p) {
            return { id: p.id, name: p.name, x: round1(p.x), y: round1(p.y), taps: p.taps, tool: p.tool };
          }),
          dots: dots.map(function (d) { return [round1(d.x), round1(d.y)]; })
        };
      },

      result: function () {
        if (g.state === 'intro' || g.state === 'play') return null;
        var won = g.state === 'won' || g.state === 'done';
        return { won: won, medal: won ? (g.t < 60 ? 3 : g.t < 120 ? 2 : 1) : 0, time: round1(g.t), reason: g.reason };
      }
    };
  }

  globalThis.NaadanCore = { createGame: createGame, LEVEL_COUNT: LEVEL_COUNT, VERSION: VERSION };
})();
