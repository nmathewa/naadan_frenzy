# Naadan Frenzy multiplayer server

The online farm for up to 3 players. It runs on Cloudflare Workers with one
Durable Object per 4-letter farm code. The server runs the real game rules
(`../core.js`, the same file the browser loads) at 20 steps a second and
sends every player a small snapshot (about 700 bytes) 12 times a second, so
no phone has to act as the host.

## Deploying

Cloudflare Workers Builds deploys this folder whenever `main` changes:

| Setting          | Value                   |
| ---------------- | ----------------------- |
| Project name     | `naadan-frenzy-server`  |
| Root directory   | `server`                |
| Build command    | (empty)                 |
| Deploy command   | `npm run deploy`        |

No API token is needed in the repo. The server's address is
`https://naadan-frenzy-server.<your-subdomain>.workers.dev`; `GET /health`
returns `{"ok":true,"version":"1"}`.

## Running locally

```sh
npm install
npm run dev:test        # local server on :8787 with a 3 s reconnect window
npm test                # three simulated players, in another terminal
```

`npm run dev` runs with the real 60 s reconnect window.

## Protocol

Connect a WebSocket to `/ws/<CODE>?name=<name>&pid=<stable id>&v=1`, adding
`&create=1` to make a new farm. `v` must match `NaadanCore.VERSION`.

Server to client:

- `{t:'room', code, you, leader, phase, li, players:[{id,name,color,online}]}` whenever membership changes
- `{t:'start', li, opts:{nights, up}}` when a level starts (or on reconnect)
- `{t:'s', ...snapshot, ev:[events for you], ack:<last input seq>}` at 12 Hz during a level
- `{t:'end', result:{won, medal, time, reason}}` when the level is over
- `{t:'say', id, from}` and `{t:'pong', c}`
- `{t:'error', code, msg}` then close: `badcode`, `version`, `nofarm`, `taken`, `full`

Client to server:

- inputs, each with a `seq`: `tap`, `buy`, `mk`, `go`, `upauto`, `upstore` (same shape as `engine.input`)
- leader only: `{t:'start', li, up, nights}`, `{t:'play'}`, `{t:'map'}`
- `{t:'say', id}` (1 per second), `{t:'ping', c}`, `{t:'leave'}`

A dropped player keeps their place for 60 s and gets it back by reconnecting
with the same `pid`. The earliest player still in the farm is the leader.
