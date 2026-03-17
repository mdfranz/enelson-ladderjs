# ladderjs

> The 1982 CP/M game _Ladder_, ported to JavaScript and playable in your browser.

![ladder main menu](images/ladder-main-menu.png)

## What is Ladder?

When I was a kid, the first computer I got to play with was called the Kaypro II, and it looked just like this.

![Kaypro II](images/kayproii.jpg)

This thing had a single-color text-only screen, and no hard drive at all (you could only use programs loaded into memory from the two 5.25" floppy drives). The game Ladder was bundled with the Kaypro II and was inspired by the arcade game Donkey Kong, which had come out a year earlier in 1981.

Although it's not much to look at, the gameplay was solid. At the time I was still painstakingly typing in BASIC games from books I checked out of the library and hoping they would run, and a game that ran as fast and smooth as Ladder seemed like sorcery to me.

## Introducing ladderjs

Not only did I think it would be fun to play Ladder again, I thought it would be fun to implement it myself. Most of my amateur game development has been HTML5 games for the [js13kgames competition](https://js13kgames.com), so implementing Ladder in JavaScript/HTML5 seemed like a natural fit. It also lets people who have never seen or heard of it try it out immediately, so that's a bonus.

I'm not the first person to have this idea -- Stephen Ostermiller has been maintaining his [Java port](https://ostermiller.org/ladder/) for many years, and there's also an excellent [Turbo Pascal port](https://github.com/mecparts/Ladder), both of which I referenced heavily while creating my version.

One difference between the previous ports and `ladderjs` is that I wanted ladderjs to be _written the way you would write a JavaScript game today_. The way I handle the HTML5 canvas, keyboard events, and the basic update/draw game loop is essentially the same way I do in my annual js13k games, and the rest of the logic I've attempted to simplify and document as much as possible, so that an aspiring game developer can use it as a basis for their own games.

## Play it now

You can play ladderjs in your browser at [ladderjs.7tonshark.com](https://ladderjs.7tonshark.com).

Alternatively, run the headless server locally and play via WebSocket or REST API:

```bash
npm install
npm run build:server
npm start
# Server runs at http://localhost:3000
```

## REST & WebSocket Interface

The game can run headlessly in Node.js and be controlled remotely via HTTP and WebSocket:

### Running the Server

```bash
npm run build:server    # Build the server bundle
npm start               # Start on port 3000
```

Example output:
```text
mdfranz@acer-cr516g:~/github/enelson-ladderjs$ npm start

> ladderjs@0.4.0 start
> node dist/server.js

Server running at http://localhost:3000
  - WebSocket:     ws://localhost:3000
  - Browser:       http://localhost:3000
  - Original game: http://localhost:3000/game
  - REST API:      http://localhost:3000/api/state
```

The server provides several ways to interact with the game:

- **Browser Viewer (`/`)**: A web-based "monitor" that connects to the server via WebSocket. It displays the current state of the game running on the server and allows you to play using your keyboard.
- **Original Game (`/game`)**: The standalone, client-side version of the game. This runs entirely in your browser and does not synchronize with the server's state.
- **WebSocket (`ws://...`)**: A real-time stream of game data. The server broadcasts the full 80x24 screen buffer and session state (score, lives, etc.) to all connected clients at 60 frames per second. You can also send input commands back to the server.
- **REST API (`/api/state`)**: A standard HTTP interface for polling the current game state or sending one-off input commands. This is ideal for building bots or external dashboards.

### Browser Viewer

Open `http://localhost:3000` in your browser to watch and play the game with keyboard controls.

### REST API

**Get game state:**
```bash
curl http://localhost:3000/api/state
```

Response:
```json
{
  "frame": 1234,
  "screen": ["...", "..."],  // 24 strings of 80 characters each
  "session": {
    "score": 1000,
    "lives": 3,
    "level": 0,
    "paused": false
  }
}
```

**Send input:**
```bash
curl -X POST http://localhost:3000/api/input \
  -H 'Content-Type: application/json' \
  -d '{"action":"RIGHT"}'
```

Valid actions: `UP`, `DOWN`, `LEFT`, `RIGHT`, `JUMP`, `STOP`, `PAUSE`, `RESUME`.

### WebSocket

Connect to `ws://localhost:3000` to receive frame updates at ~60/s and send input:

**Receive** (from server, every frame):
```json
{ "type": "frame", "frame": 1234, "screen": [...], "session": {...} }
```

**Send** (to server):
```json
{ "type": "input", "action": "JUMP" }
```

### Original Game

The standalone browser game is available at `http://localhost:3000/game` or by opening `dist/index.html` directly.

## Development

Build commands:
- `npx gulp build` — Browser game bundle
- `npm run build:server` — Headless server bundle
- `npx gulp watch` — Watch mode for browser bundle

## Core Mechanics

Ladder is an ASCII-based platformer where you navigate Lad through various levels.

- **Lad (`p`)**: Your character. Use `WASD` or Arrow keys to move and `Space` to jump.
- **Treasure (`$`)**: Your primary goal. Collect these to finish the level.
- **Statues (`&`)**: Collect these for bonus points proportional to your remaining time.
- **Rocks (`o`)**: Falling hazards dispensed from `V` tiles. Jump over them for points!
- **Ladders (`H`)**: Essential for vertical navigation.
- **Fire (`^`)**: Deadly floor hazards.
- **Trampolines (`.`)**: Bounces you in a random direction.
- **Keys (`K`) & Doors (`#`)**: A puzzle element—collecting a key removes all door tiles in the level.
- **Ghosts (`W`)**: Chaser enemies that spawn from `G` dispensers and actively track your movement.

## Architecture

The project follows a modular, decoupled design aimed at being easy to read and extend:

- **State Management**: `Game.js` runs the top-level loop, while `GameSession.js` tracks persistent state like score and lives.
- **Level Logic**: `PlayingField.js` handles all real-time interactions, collisions, and entity updates for a specific level.
- **ASCII Rendering**: `Screen.js` maintains a virtual 80x24 character buffer, which `Viewport.js` then renders to the HTML5 Canvas with retro-style scaling and scanline effects.
- **Entity System**: Entities like `Player`, `Rock`, and `Ghost` are encapsulated in their own classes, making it simple to add new behaviors.
- **Tooling**: A Gulp-based pipeline handles asset generation, JavaScript bundling via Rollup, and minification.

## Changelog

| Version | Summary |
| --- | --- |
| v0.5.0 | New mechanics: Keys, Doors, and Ghost chaser enemies. Refactored level parsing. |
| v0.4.0 | Simple sound effects using the zzfx library. |
| v0.3.0 | Better air control (stop / change directions mid air), like original game. |
| v0.2.0 | Made available publicly at [ladderjs.7tonshark.com](https://ladderjs.7tonshark.com). |
| v0.1.0 | Initial, mostly-working game with all 7 original levels. |
