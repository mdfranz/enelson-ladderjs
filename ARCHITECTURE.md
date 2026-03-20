# LadderJS Architecture

This document describes how `ladderjs` is structured today, including browser play, headless server mode, and the Python tooling used for automation/replay.

## High-Level Design

LadderJS has one core gameplay codebase (`src/js/*`) that is executed in two environments:

- Browser mode: standalone game rendered to `<canvas>`.
- Headless server mode: same game rules, no canvas/audio rendering, state exposed through WebSocket + REST.

The key architectural choice is to keep gameplay logic independent from concrete rendering and audio, then swap environment-specific implementations during server bundling.

## Repository Layout

- `src/js/`: Core game and server/runtime modules.
- `src/js/shims/`: Headless replacements for browser-only modules.
- `src/levels/levels.json`: Data-driven level definitions.
- `src/assets/`: Aseprite sources and generated sprite metadata.
- `build.js`: Build pipeline for browser bundle, server bundle, assets, CSS, and HTML.
- `client.html`: Thin WebSocket viewer/controller for the headless server.
- `bot.py`, `viewer.py`, `replay.py`: Python automation and analysis tools.
- `dist/`: Build outputs (`app.js`, `server.js`, `index.html`, `app.css`, `sprites.png`).

## Runtime Modes

### Browser Runtime

Entry point: `src/js/index.js` -> `Game.init()`.

Initialization order:

1. `Sprite.loadSpritesheet()`
2. `Viewport.init()`
3. `Screen.init()`
4. `Sprite.init()`
5. `Text.init()`
6. `Input.init()`
7. `Audio.init()`
8. `Game.start()`

`Game.onFrame()` is driven by `requestAnimationFrame`, then internally rate-limited to ~60Hz.

### Headless Server Runtime

Entry point: `src/js/server.js` -> `startServer()` in `HttpServer`.

`ServerGame` monkey-patches the `Game` singleton to avoid browser-only behavior and runs its own 60Hz loop via `setInterval`. Each tick:

1. Updates input/audio/menu/session.
2. Draws into the virtual `Screen` buffer (no canvas draw).
3. Emits a snapshot to subscribed callbacks.

`HttpServer` broadcasts each snapshot to all connected WebSocket clients and exposes REST endpoints for polling and input injection.

## Core Game Model

### State Ownership

- `Game` (singleton): top-level mode switching (`MainMenu`, `InstructionsMenu`, `GameSession`), frame counter, play speed.
- `GameSession`: cross-level state (`score`, `lives`, `levelNumber`, pause state, difficulty scaling).
- `PlayingField`: one active level instance (layout copy, player, hazards, timers, win/death handling).
- `Level`: immutable level data loader/parser from JSON.

### Fixed Character-Space Rendering

The game writes text-like glyphs into `Screen.screen` (2D char array) rather than drawing entities directly to canvas.

- Logical screen dimensions: `SCREEN_WIDTH = 80`, `SCREEN_HEIGHT = 24`.
- Level play area dimensions: `LEVEL_ROWS = 20`, `LEVEL_COLS = 79`.

In browser mode, `Screen.draw()` converts the buffer to text and `Text.drawText()` paints glyph sprites to canvas. In server mode, the same buffer is serialized to string rows and streamed.

## Game Loop and Timing

Two timing layers are used:

- Engine frame: ~60Hz loop (`Game.onFrame()` or `ServerGame._tick()`).
- Movement gating: `GameSession.update()` applies an additional delay (`PLAY_SPEEDS`) and hidden scaling (`hiddenFactor`) to determine `moveFrame`.

Result: animations and UI can still update every engine frame while movement speed changes by difficulty.

## Entity and Movement Architecture

### Entity State Machine

`Entity.js` defines shared movement states (`LEFT`, `RIGHT`, `FALLING`, jump states, death states, etc.) and `applyEntityMovement()`.

Movement uses queued intent (`nextState`) to support “Pac-Man style” buffered input.

### Player

`Player.update()` consumes high-level actions from `Input`, maps them to state transitions, and calls `applyEntityMovement()` only on `moveFrame` ticks.

### Rocks

`Rock` entities spawn from `V` dispensers, animate spawn/death, switch directions at boundaries/obstacles, can descend ladders probabilistically, and die on eater (`*`) tiles.

### Ghosts

`Ghost` entities spawn from `G` dispensers and move every `moveSpeed` frames using a simple chase heuristic prioritizing the dominant axis, avoiding solid tiles.

### Collision and Scoring

`PlayingField` owns interaction logic:

- Player death checks (fire, timeout, rock/ghost contact).
- Pickup handling (statues, keys, treasure).
- Door unlock behavior (`K` clears all `#`).
- End-of-level bonus conversion (remaining time -> repeated treasure scoring).

`GameSession.updateScore()` centralizes score/life updates and audio trigger hooks.

## Level Data Contract

Source: `src/levels/levels.json`.

Each level object includes:

- `name`: level display name.
- `layout`: ASCII rows.
- optional `time`, `maxRocks` style extensions (if present in data).

`Level.load(levelNumber)`:

- Wraps level number by available level count.
- Crops/pads layout to `LEVEL_ROWS x LEVEL_COLS`.
- Extracts `player`, `dispensers` (`V`), `ghostDispensers` (`G`).
- Replaces player spawn marker `p` in layout with empty space.

## Input Architecture

`Input` stores:

- `buffer`: unconsumed key events for gameplay/menu decisions.
- `history`: short rolling history (~3s) used for cheat code detection.

Events are normalized into `Input.Action` values through `KeyMapping`, but code can still inspect raw keys (`lastKey`) for menu commands.

Server mode uses the same `Input.buffer`; actions/keys are injected programmatically by `ServerGame.injectAction()` and `ServerGame.injectKey()`.

## Networking and APIs

Implemented in `HttpServer`.

### WebSocket

- Endpoint: same host/port root (`ws://<host>:<port>`).
- Outbound messages: `{ type: 'frame', frame, screen, session }` every server tick.
- Inbound commands:
  - `{ type: 'input', action: 'RIGHT' }`
  - `{ type: 'key', key: 'ArrowRight', code: 'ArrowRight' }`

### REST

- `GET /api/state`: returns latest snapshot.
- `POST /api/input`: injects action (`UP`, `DOWN`, `LEFT`, `RIGHT`, `JUMP`, `STOP`, `PAUSE`, `RESUME`).

### Snapshot Shape

`ServerGame.snapshot()` returns:

- `frame`: frame number.
- `screen`: array of 24 strings.
- `session`: nullable metadata object (`score`, `lives`, `level`, `paused`).

## Build and Asset Pipeline

`build.js` orchestrates:

1. Version generation: writes `src/js/GameVersion-gen.json` from `package.json`.
2. Asset export: optional Aseprite CLI run -> packed PNG + JSON metadata.
3. Sprite metadata generation: `tools/image-data-parser.js` -> `src/js/SpriteSheet-gen.js`.
4. Browser JS bundle: Rollup (`src/js/index.js` -> `dist/app.js`, IIFE).
5. CSS minification: `src/app.css` -> `dist/app.css`.
6. HTML minification: `src/index.html` -> `dist/index.html`.
7. Server JS bundle: Rollup (`src/js/server.js` -> `dist/server.js`, ESM) with alias-based shim swapping.

Server build aliases browser modules to headless shims:

- `Viewport` -> `shims/ServerViewport.js`
- `Text` -> `shims/ServerText.js`
- `Audio` -> `shims/ServerAudio.js`
- `Sprite` -> `shims/ServerSprite.js`
- `logger.js` -> `shims/ServerLogger.js`

## Logging and Observability

- Browser runtime: `src/js/logger.js` uses console passthrough.
- Server runtime: `ServerLogger` uses `pino` (stdout or `LOG_FILE` destination).
- Game events (score, level transitions, deaths, injected inputs) are logged from gameplay/server modules.

## Python Tooling Integration

### `bot.py`

WebSocket bot client with:

- Frame parsing into structured state.
- Hazard detection and evasive overrides.
- Step-based navigator behavior.
- JSON log output for training/replay workflows.

### `viewer.py`

Terminal WebSocket viewer using curses; renders latest server frame and session info.

### `replay.py`

Offline curses replay of logged session data (`training_data.json`) against level layouts.

## Known Architectural Gaps and Risks

These are current code-level issues worth tracking:

1. `ServerGame.snapshot()` exposes `session.level` from `Game.session.level`, but gameplay state uses `levelNumber`; this can report incorrect level info.
2. `HttpServer` serves static files from project root (`express.static(process.cwd())`), which is broader than necessary for production hosting.
3. Level dimensions are intentionally non-uniform (`80x24` screen vs `79x20` playfield); this is functional but easy to misinterpret when extending level/render logic.
4. No automated tests are present (`npm test` is a placeholder), so architecture regressions rely on manual verification.

## Extension Points

Common safe extension areas:

- Add entities: create class + update/draw integration in `PlayingField`.
- Add tiles/mechanics: extend level symbol checks and utility predicates in `PlayingField`/`Level`.
- Add external controllers: reuse WebSocket/REST input injection.
- Add observability: hook into `ServerGame.onFrame()` for telemetry recorders.

For compatibility, preserve the virtual `Screen` contract and keep gameplay logic independent from rendering APIs.
