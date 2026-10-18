/*
 * engine.js — loads the game engine and exposes it as `Core`.
 *
 * core.js is a classic script that sets globalThis.NaadanCore when evaluated.
 * We pull it in with a side-effect import of the bare module "naadan-core",
 * which wrangler.jsonc aliases to the repo-root ../core.js.
 *
 * Note: the bundle is an ES module, so core.js runs in strict mode with
 * module scope: it must assign globalThis.NaadanCore explicitly and must not
 * rely on sloppy-mode features (implicit globals, top-level `this`, `with`).
 */
import 'naadan-core';

const Core = globalThis.NaadanCore;

// Fail at startup (and therefore at deploy time) rather than on the first game.
if (!Core || typeof Core.createGame !== 'function') {
  throw new Error('naadan-core did not set globalThis.NaadanCore.createGame');
}
if (!Number.isInteger(Core.LEVEL_COUNT) || Core.LEVEL_COUNT < 1) {
  throw new Error('NaadanCore.LEVEL_COUNT must be a positive integer');
}

export { Core };
