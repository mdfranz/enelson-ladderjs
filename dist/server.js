import express from 'express';
import path from 'path';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import pino from 'pino';

/**
 * ServerSprite - Minimal stub for headless server environment
 * Replaces Sprite for server-side game execution
 */

const Sprite = {
    font: {
        img: null,
        anchor: { x: 0, y: 0 }
    },

    loadSpritesheet(cb) {
        setImmediate(cb);
    },

    init() {
        // No-op
    },

    drawSprite() {
        // No-op
    },

    drawViewportSprite() {
        // No-op
    },

    viewportSprite2uv() {
        return { u: 0, v: 0 };
    }
};

/**
 * ServerAudio - No-op stub for headless server environment
 * Replaces Audio for server-side game execution
 */

const Audio = {
    readyToPlay: false,
    ctx: null,
    gain_: null,
    begin: [,,539,0,.04,.29,1,1.92,,,567,.02,.02,,,,.04],
    jump: [,.1,75,.03,.08,.17,1,1.88,7.83,,,,,.4],
    score: [.7,.08,1675,,.06,.16,1,1.82,,,837,.06],
    dying: [,,925,.04,.3,.6,1,.3,,6.27,-184,.09,.17],
    soundThrottle: new Map(),
    soundDelays: new Map(),
    musicPlaying: false,

    init() {
        this.soundThrottle = new Map();
        this.soundDelays = new Map();
        this.soundDelays.set(this.score, 160);
    },

    update() {
        // No-op
    },

    play() {
        // No-op
    },

    pause() {
        // No-op
    },

    unpause() {
        // No-op
    }
};

const dest = process.env.LOG_FILE 
  ? pino.destination({ dest: process.env.LOG_FILE, sync: true }) 
  : pino.destination(1); // 1 is stdout

const logger = pino({
  timestamp: pino.stdTimeFunctions.isoTime
}, dest);

/**
 * `Input` is a singleton that helps us map keyboard events in the browser
 * to in-game actions.
 *
 * We generally care about two types of input events:
 *
 *  - An "action" is a specific action recognizable by the game, like moving right
 *    or jumping. In theory, if this was a more complicated game, there could be
 *    many ways to cause a specific action (maybe user presses SPACEBAR to jump,
 *    or they click RIGHT MOUSE BUTTON, or they tap A on a gamepad, etc.). For this
 *    reason, it helps to separate processing in-game actions from processing the
 *    raw keyboard events that cause them.
 *
 *  - Actual key presses. There are situations where we need a more broad view of
 *    the user's key presses, for example, if they are typing in their name for a
 *    high score or pressing one of the inputs at the main menu. In this case we
 *    want to know "did the user tap P?", as opposed to mapping the keys to actions.
 */


// A list of in-game actions that can be performed by the player
const Action = {
    UP:     11,
    DOWN:   12,
    LEFT:   13,
    RIGHT:  14,
    JUMP:   15,
    STOP:   16,
    PAUSE:  17,
    RESUME: 18
};

// A list of key code mappings and what action they perform. Here we hard-code it, but
// you could easily also have the key mappings controlled by settings and let the user
// configure it.
const KeyMapping = {
    KeyW:       Action.UP,
    KeyS:       Action.DOWN,
    KeyA:       Action.LEFT,
    KeyD:       Action.RIGHT,
    ArrowUp:    Action.UP,
    ArrowDown:  Action.DOWN,
    ArrowLeft:  Action.LEFT,
    ArrowRight: Action.RIGHT,
    Space:      Action.JUMP,
    Escape:     Action.PAUSE,
    Enter:      Action.RESUME
};

const Input = {
    Action,
    KeyMapping,

    init() {
        // Input buffer - new keypress events go into this buffer to be handled
        // during the game's update loop. It's up to the `update()` methods to consume
        // key presses and remove them from the buffer.
        this.buffer = [];

        // Input history - history contains recent key press events in order,
        // removed automatically after a few seconds. This is useful for detecting
        // inputs like cheat codes, for example.
        //
        // (Actually, cheat codes is the only use for this extra history buffer, so
        // if you didn't support cheat codes you could delete it altogether.)
        this.history = [];

        if (typeof window !== 'undefined') {
            window.addEventListener('keydown', event => {
                let entry = {
                    at: new Date().getTime(),
                    key: event.key,
                    code: event.code,
                    action: Input.KeyMapping[event.code] || Input.Action.STOP
                };
                Input.buffer.push(entry);
                Input.history.push(entry);
                logger.info({ input: entry }, 'Key down');

                // Hack to ensure we initialize audio after user interacts with the game. Sometimes
                // the browser will just ignore attempts to play audio if the user has not interacted
                // with the page yet, but some browsers/versions will actually error out (either
                // stopping the game itself, or preventing later audio playing). So it's better to
                // plan for it explicitly.
                Audio.readyToPlay = true;
            });
        }
    },

    update() {
        let now = new Date().getTime();
        this.history = this.history.filter(entry => entry.at > now - 3000);
    },

    lastKey() {
        // A shortcut helper for code that cares about what KEY was pressed.
        return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].key : '';
    },

    lastAction() {
        // A shortcut helper for code that cares about what ACTION was taken.
        return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].action : undefined;
    },

    consume(clearHistory) {
        this.buffer = [];

        // Normally, "consuming" all existing buffer input is something that happens
        // somewhere in the game logic. If we just detected and acted on a cheat code,
        // though, we want to clear the history too, otherwise we'll just keep behaving
        // like the user is entering the cheat code every frame.
        if (clearHistory) this.history = [];
    }
};

/**
 * Global constants for our game.
 *
 * I export all constants individually and import just the ones I want in each file that
 * uses them. In theory this helps with tree-shaking and lets you see at a glance which
 * files use which constants, but mostly it works only because this is a small game. If you
 * have hundreds of constants it's probably better to export a single `Constants` object and
 * let them be namespaced.
 */


// The "screen area". This is an ASCII game and so most of the game logic doesn't care about browser
// pixels, we care about the ASCII display area (80x25).
//
// Actually the original was likely an 80x24. We can use either here, whatever looks good in the browser.
const SCREEN_WIDTH = 80;
const SCREEN_HEIGHT = /*25*/ 24;

// The size of our on-screen characters (given dimensions above, this is 80 cols by 25 rows).
const CHAR_WIDTH = 8;
const CHAR_HEIGHT = 16;

// A screen scale factor. This scale factor multiplies the entire screen size so that
// we can then introduce text artifacts (like character glow and scan lines), to give it
// a little of that 1982 feel.
const SCREEN_SCALE = 4;

// The playable area. Note that this is the desired dimensions, but the actual on-screen dimensions
// may be larger to maintain aspect ratio (see `Viewport.width` & `Viewport.height`).
//
// Note the extra little padding of a character, which just prevents our text from butting right
// against the edge of the browser window.
const GAME_WIDTH = (SCREEN_WIDTH + 1) * CHAR_WIDTH * SCREEN_SCALE;
const GAME_HEIGHT = (SCREEN_HEIGHT + 1) * CHAR_HEIGHT * SCREEN_SCALE;

// Fixed level size
const LEVEL_ROWS = 20;
const LEVEL_COLS = 79;

// Play speeds, expressed as frames per second.
//
// According to the original, the play speeds had millisecond delays of:
//   [100ms, 50ms, 25ms, 13ms, 7ms].
//
// This would mean the effective FPS was:
//   [10, 20, 40, 76, 142].
//
// I think this is way too high, and might not be accurate (it doesn't count
// time spent drawing the screen and running the game's logic, which might
// be a significant number of milliseconds). From memory, each speed was about
// 50% faster than the previous one, so that's what I've set here.
const PLAY_SPEEDS = [120, 100, 90, 50, 30];

// Maximum number of rocks on screen at once
const MAX_ROCKS = 7;

// Each dispenser on the level increases max rocks by 1
const DISPENSER_MAX_ROCKS = 1;

// Hidden difficulty factor - the game gets 5% faster each level cycle
const HIDDEN_FACTOR_PLAY_SPEED = 0.05;

// Hidden difficulty factor - the maximum number of rocks increases each level cycle
const HIDDEN_FACTOR_MAX_ROCKS = 2;

// Score events (note, these are just identifiers for the types of score increases, not
// actual score values).
const SCORE_ROCK = 1;
const SCORE_STATUE = 2;
const SCORE_TREASURE = 3;
const SCORE_KEY = 4;

// 1-Up
const NEW_LIFE_SCORE = 10_000;

// Maximum number of ghosts on screen at once
const MAX_GHOSTS = 3;

/**
 * ServerText - No-op stub for headless server environment
 * Replaces Text for server-side game execution
 */


const Text = {
    glow: null,

    init() {
        // No-op
    },

    drawText() {
        // No-op
    },

    splitParagraph() {
        return [];
    },

    measureWidth() {
        return 0;
    }
};

/**
 * ServerViewport - No-op stub for headless server environment
 * Replaces Viewport for server-side game execution
 */


const Viewport = {
    ctx: null,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    scale: 1,
    center: { u: GAME_WIDTH / 2, v: GAME_HEIGHT / 2 },

    init() {
        // No-op
    },

    resize() {
        // No-op
    }
};

/**
 * `Screen` is a singleton that represents the virtual 80x25 character screen our game
 * lives in. Components like PlayingField will "draw" (write text onto) this virtual
 * screen each frame. Once all the text is written, the text will end up rendered on
 * the viewport (canvas) in the browser.
 */


const Screen = {
    init() {
        this.screen = [];
        for (let y = 0; y < SCREEN_HEIGHT; y++) {
            this.screen.push([]);
        }
        this.clear();
    },

    clear() {
        for (let y = 0; y < SCREEN_HEIGHT; y++) {
            for (let x = 0; x < SCREEN_WIDTH; x++) {
                this.screen[y][x] = ' ';
            }
        }
    },

    write(x, y, text) {
        if (!Array.isArray(text)) text = [text];

        for (let j = 0; j < text.length; j++) {
            for (let i = 0; i < text[j].length; i++) {
                this.screen[y + j][x + i] = text[j][i];
            }
        }
    },

    draw(ctx) {
        this.screen.map(row => row.join('')).join('\n');
    }
};

var GameVersion = "0.5.0";

/**
 * `MainMenu` is a class that represents a screen the user can view. Instances of
 * MainMenu are constructed whenever we want the user to go to the main menu, and
 * thrown away when we're done.
 */


class MainMenu {
    update() {
        switch (Input.lastKey().toUpperCase()) {
            case 'P':
                Input.consume();
                Game.startSession();
                break;
            case 'L':
                Input.consume();
                Game.playSpeed = (Game.playSpeed + 1) % PLAY_SPEEDS.length;
                break;
            case 'I':
                Input.consume();
                Game.showInstructions();
                break;
            case 'E':
                Input.consume();
                Game.showInstructions();
                break;
        }
    }

    draw() {
        let terminal = 'Quiche MkII';

        let highScores = [
            `1) 6000  Bob`,
            `2) 6000  Tom`,
            `3) 4000  Wayne`,
            ``,
            ``
        ];

        Screen.clear();
        Screen.write(0, 0, [
            `               LL                     dd       dd`,
            `               LL                     dd       dd                      tm`,
            `               LL         aaaa     ddddd    ddddd    eeee   rrrrrrr`,
            `               LL        aa  aa   dd  dd   dd  dd   ee  ee  rr    rr`,
            `               LL        aa  aa   dd  dd   dd  dd   eeeeee  rr`,
            `               LL        aa  aa   dd  dd   dd  dd   ee      rr`,
            `               LLLLLLLL   aaa aa   ddd dd   ddd dd   eeee   rr`,
            ``,
            `                                       Version:    ${GameVersion}`,
            `(c) 1982, 1983 Yahoo Software          Terminal:   ${terminal}`,
            `10970 Ashton Ave.  Suite 312           Play speed: ${Game.playSpeed + 1} / ${PLAY_SPEEDS.length}`,
            `Los Angeles, Ca  90024                 Move = ↑↓←→/WASD, Jump = Space,`,
            `                                       Stop = Other`,
            ``,
            `P = Play game                          High Scores`,
            `L = Change level of difficulty         ${highScores[0]}`,
            `C = Configure Ladder                   ${highScores[1]}`,
            `I = Instructions                       ${highScores[2]}`,
            `E = Exit Ladder                        ${highScores[3]}`,
            `                                       ${highScores[4]}`,
            ``,
            `Enter one of the above:`
        ]);
    }
}

class InstructionsMenu {
    constructor() {
    }

    update() {
        if (Input.lastKey().toUpperCase() !== '') {
            Input.consume();
            Game.showMainMenu();
        }
    }

    draw() {
        Screen.clear();
        Screen.write(0, 0, [
            `You are a Lad trapped in a maze.  Your mission is is to explore the`,
            `dark corridors never before seen by human eyes and find hidden`,
            `treasures and riches.`,
            ``,
            `You control Lad by typing the direction buttons and jumping by`,
            `typing SPACE.  But beware of the falling rocks called Der rocks.`,
            `You must find and grasp the treasures (shown as $) BEFORE the`,
            `bonus time runs out.`,
            ``,
            `A new Lad will be awarded for every 10,000 points.`,
            `Extra points are awarded for touching the gold`,
            `statues (shown as &).  You will receive the bonus time points`,
            `that are left when you have finished the level.`,
            ``,
            `Type an ESCape to pause the Game`,
            ``,
            `Remember, there is more than one way to skin a cat. (Chum)`,
            ``,
            `Good luck Lad.`,
            ``,
            ``,
            ``,
            `Type RETURN to return to main menu:`
        ]);
    }
}

/**
 * A collection of states and functions related to entities.
 */


// A list of states usable by entities. Some states only apply to players (rocks can't jump).
//
// Many of these are actually DIRECTIONS, but since this game has "pac man movement", a
// direction is a state -- the player will keep moving in the tapped direction until the player
// enters a new input.
const State = {
    STOPPED:    1,         // Standing still
    UP:         2,         // Moving up (player only)
    LEFT:       3,         // Moving left
    DOWN:       4,         // Moving down
    RIGHT:      5,         // Moving right
    FALLING:    6,         // Falling
    START_JUMP: 7,         // About to start a jump (player only)
    JUMP_LEFT:  8,         // Jumping left (player only)
    JUMP_RIGHT: 9,         // Jumping right (player only)
    JUMP_UP:    10,        // Jumping straight up (player only)
    DYING:      11,        // Dying (used as a death animation)
    DEAD:       12,        // Dead (for player, restart level; for rock, disappear)
    SPAWNING:   13         // Entity is spawning (invincible / not controllable)
};

// This constant controls the "shape" of the left, right, and straight-up jumps by
// the player. Note that the straight-up jump gets 1 frame less of airtime than
// the left and right jumps.
const JUMP_FRAMES = {
    [State.JUMP_RIGHT]: [
        { x: 1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 1 }
    ],
    [State.JUMP_LEFT]: [
        { x: -1, y: -1 },
        { x: -1, y: -1 },
        { x: -1, y: 0 },
        { x: -1, y: 0 },
        { x: -1, y: 1 },
        { x: -1, y: 1 }
    ],
    [State.JUMP_UP]: [
        { x: 0, y: -1 },
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 1 },
        { x: 0, y: 0 }
    ]
};

function applyEntityMovement(entity, field) {
    let repeat = false;

    // This method contains generic "movement" application for all entities, including
    // Lad (player) and Der Rocks (enemies). Things like falling, moving left/right, etc.,
    // work the same for both.
    //
    // (There's a bunch of jump logic in here too, and moving UP, which really only applies
    // to players, but that's OK -- Der Rocks just won't attempt those actions.)

    if (entity.nextState) {
        switch (entity.state) {
            case State.STOPPED:
            case State.LEFT:
            case State.RIGHT:
                if ([State.LEFT, State.RIGHT, State.STOPPED].includes(entity.nextState)) {
                    entity.state = entity.nextState;
                    entity.nextState = undefined;
                }
                break;

            case State.UP:
            case State.DOWN:
                // Normal
                if ([State.LEFT, State.RIGHT].includes(entity.nextState)) {
                    entity.state = entity.nextState;
                    entity.nextState = undefined;
                }
                break;

            case State.JUMP_LEFT:
            case State.JUMP_RIGHT:
            case State.JUMP_UP:
                if (entity.nextState === State.RIGHT && entity.state != State.JUMP_RIGHT) {
                    entity.state = State.JUMP_RIGHT;
                    entity.nextState = State.RIGHT;
                }
                if (entity.nextState === State.LEFT && entity.state != State.JUMP_LEFT) {
                    entity.state = State.JUMP_LEFT;
                    entity.nextState = State.LEFT;
                }
                if (entity.nextState === State.DOWN) {
                    entity.state = State.FALLING;
                    entity.nextState = undefined;
                }
                if (entity.nextState === State.UP) ;
                break;
        }
    }

    if (entity.nextState === State.START_JUMP) {
        // Special case: the user wants to jump!
        //
        // If the player is standing on something solid, we initiate a jump based on the current
        // movement of the player.
        if (field.onSolid(entity.x, entity.y)) {
            if (entity.state === State.STOPPED || entity.state === State.FALLING) {
                entity.state = State.JUMP_UP;
                entity.jumpStep = 0;
                entity.nextState = State.STOPPED;
            } else if (entity.state === State.LEFT || entity.state === State.JUMP_LEFT) {
                entity.state = State.JUMP_LEFT;
                entity.jumpStep = 0;
                entity.nextState = State.LEFT;
            } else if (entity.state === State.RIGHT || entity.state === State.JUMP_RIGHT) {
                entity.state = State.JUMP_RIGHT;
                entity.jumpStep = 0;
                entity.nextState = State.RIGHT;
            }
        }
    } else if (entity.nextState === State.UP && field.isLadder(entity.x, entity.y)) {
        // Special case: the user wants to go up!
        //
        // If the user is on a ladder, we can start ascending. Note that if the user is not
        // on a ladder we ignore their input, which is intentional -- this allows queued
        // (pacman) input, where we can tap UP a little before reaching the ladder.
        entity.state = State.UP;
        entity.nextState = undefined;
    } else if (entity.nextState === State.DOWN && (field.isLadder(entity.x, entity.y) || field.isLadder(entity.x, entity.y + 1))) {
        // Special case: the player wants to go down!
        //
        // If the player is on (or above) a ladder, we can start descending. Note that if the player is not
        // on a ladder we ignore their input, which is intentional -- this allows queued
        // (pacman) input, where we can tap DOWN a little before reaching the ladder.
        entity.state = State.DOWN;
        entity.nextState = undefined;
    }

    switch (entity.state) {
        case State.LEFT:
            if (!field.onSolid(entity.x, entity.y)) {
                entity.nextState = State.LEFT;
                entity.state = State.FALLING;
                repeat = true;
                break;
            }
            if (field.emptySpace(entity.x - 1, entity.y)) {
                entity.x--;
            } else {
                entity.nextState = State.STOPPED;
            }
            break;

        case State.RIGHT:
            if (!field.onSolid(entity.x, entity.y)) {
                entity.nextState = State.RIGHT;
                entity.state = State.FALLING;
                repeat = true;
                break;
            }
            if (field.emptySpace(entity.x + 1, entity.y)) {
                entity.x++;
            } else {
                entity.nextState = State.STOPPED;
            }
            break;

        case State.UP:
            if (field.canClimbUp(entity.x, entity.y - 1)) {
                entity.y--;
            } else {
                entity.state = State.STOPPED;
            }
            break;

        case State.DOWN:
            if (field.canClimbDown(entity.x, entity.y + 1)) {
                entity.y++;
            } else {
                entity.state = State.STOPPED;
            }
            break;

        case State.JUMP_RIGHT:
        case State.JUMP_LEFT:
        case State.JUMP_UP:
            let step = JUMP_FRAMES[entity.state][entity.jumpStep];
            if ((entity.x + step.x >= 0) && (entity.x + step.x < LEVEL_COLS) &&
                (entity.y + step.y >= 0) && (entity.y + step.y < LEVEL_ROWS)) {
                let terrain = field.layout[entity.y + step.y][entity.x + step.x];
                if (['=', '|', '-'].includes(terrain)) {
                    if (field.onSolid(entity.x, entity.y)) {
                        entity.state = entity.nextState;
                        entity.nextState = undefined;
                    } else {
                        switch (entity.state) {
                            case State.JUMP_RIGHT:
                                entity.nextState = State.RIGHT;
                                break;
                            case State.JUMP_LEFT:
                                entity.nextState = State.LEFT;
                                break;
                            case State.JUMP_UP:
                                entity.nextState = State.UP;
                                break;
                        }
                        entity.state = State.FALLING;
                    }
                } else if (terrain === 'H') {
                    entity.x += step.x;
                    entity.y += step.y;

                    if (entity.nextState === State.UP) {
                        entity.state = State.UP;
                    } else {
                        entity.state = State.STOPPED;
                    }
                    entity.nextState = undefined;
                } else {
                    entity.x += step.x;
                    entity.y += step.y;
                    entity.jumpStep++;

                    if (entity.jumpStep >= JUMP_FRAMES[entity.state].length) {
                        switch (entity.state) {
                            case State.JUMP_RIGHT:
                                entity.state = State.RIGHT;
                                break;
                            case State.JUMP_LEFT:
                                entity.state = State.LEFT;
                                break;
                            case State.JUMP_UP:
                                entity.state = State.UP;
                                break;
                        }
                    }
                }
            } else {
                if (field.onSolid(entity.x, entity.y)) {
                    entity.state = entity.nextState;
                    entity.nextState = undefined;
                } else {
                    entity.state = State.FALLING;
                    entity.nextState = State.STOPPED;
                }
            }
            break;

        case State.FALLING:
            if (field.onSolid(entity.x, entity.y)) {
                entity.state = entity.nextState || State.STOPPED;
            } else {
                entity.y++;
            }
            break;
    }

    // If we were attempting to move somewhere and realized we should be falling instead,
    // we want to re-run the entire algorithm once. This avoids what boils down to a "skipped
    // frame" from the user's point of view.
    if (repeat) return applyEntityMovement(entity, field);
}

const DEATH_FRAMES$2 = ['p', 'p', 'b', 'b', 'd', 'd', 'q', 'q', 'p', 'p', 'b', 'b', 'd', 'd', 'q', 'q', '-', '-', '_', '_', '_', '_', '_'];

/**
 * Player
 */
class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.state = State.STOPPED;
        this.nextState = State.STOPPED;
        this.queued = [];
        this.jumpStep = 0;
        this.deathStep = 0;
    }

    update(field, moveFrame) {
        if (this.state === State.DYING) {
            this.deathStep++;
            if (this.deathStep >= DEATH_FRAMES$2.length) this.state = State.DEAD;
        }

        if (this.state === State.DYING || this.state === State.DEAD) return;

        if (!moveFrame) return;

        let action = Input.lastAction();

        if (action === Input.Action.LEFT) {
            this.nextState = State.LEFT;
            Input.consume();
        } else if (action === Input.Action.RIGHT) {
            this.nextState = State.RIGHT;
            Input.consume();
        } else if (action === Input.Action.UP) {
            this.nextState = State.UP;
            Input.consume();
        } else if (action === Input.Action.DOWN) {
            this.nextState = State.DOWN;
            Input.consume();
        } else if (action === Input.Action.JUMP) {
            this.nextState = State.START_JUMP;
            Input.consume();
        }

        return applyEntityMovement(this, field);
    }

    draw() {
        let char = 'g';

        switch (this.state) {
            case State.RIGHT:
            case State.JUMP_RIGHT:
            case State.UP:
            case State.DOWN:
                char = 'p';
                break;

            case State.LEFT:
            case State.JUMP_LEFT:
                char = 'q';
                break;

            case State.FALLING:
                char = 'b';
                break;

            case State.DYING:
                char = DEATH_FRAMES$2[this.deathStep];
                break;

            case State.DEAD:
                char = '_';
                break;
        }

        Screen.write(this.x, this.y, char);
    }

    kill() {
        // Just a convenience method for killing the player.
        //
        // Note that "killing" the player just puts it in a dying state, we'll play
        // a little death animation as rocks move about before the player actually dies,
        // at which point they will lose a life and the level starts over.
        if (this.state != State.DYING && this.state != State.DEAD) {
            this.state = State.DYING;
        }
    }
}

/**
 * `Rock` is a class representing the Der rocks, which fall through the level
 * and kill the player if touched.
 */


const SPAWN_FRAMES$1 = ['v', 'v', 'v', 'v', 'v', 'v', '.', '.', '.'];
const DEATH_FRAMES$1 = ['.', ':', '.'];

class Rock {
    constructor(dispenser) {
        this.x = dispenser.x;
        this.y = dispenser.y;
        this.state = State.SPAWNING;
        this.nextState = undefined;
        this.spawnStep = 0;
        this.deathStep = 0;
    }

    update(field, moveFrame) {
        if (this.state === State.DYING) {
            this.deathStep++;
            if (this.deathStep >= DEATH_FRAMES$1.length) this.state = State.DEAD;
        }

        if (this.state === State.SPAWNING) {
            this.spawnStep++;
            if (this.spawnStep >= SPAWN_FRAMES$1.length) this.state = State.FALLING;
        }

        if (this.state === State.SPAWNING || this.state === State.DYING || this.state === State.DEAD) return;

        if (!moveFrame) return;

        if (this.state === State.STOPPED) {
            if (this.x === 0 || !field.emptySpace(this.x - 1, this.y)) {
                this.nextState = State.RIGHT;
            } else if (this.x === LEVEL_COLS - 1 || !field.emptySpace(this.x + 1, this.y)) {
                this.nextState = State.LEFT;
            } else {
                this.nextState = Math.random() > 0.5 ? State.LEFT : State.RIGHT;
            }
        }

        if (this.x === 0 && this.state === State.LEFT) {
            this.state = State.RIGHT;
        }

        if (this.x === LEVEL_COLS - 1 && this.state === State.RIGHT) {
            this.state = State.LEFT;
        }

        if (this.state !== State.FALLING && !field.onSolid(this.x, this.y)) {
            this.nextState = State.FALLING;
        }

        if (field.isLadder(this.x, this.y + 1) && [State.LEFT, State.RIGHT].includes(this.state)) {
            let r = Math.floor(Math.random() * 4);
            this.nextState = [State.LEFT, State.RIGHT, State.DOWN, State.DOWN][r];
        }

        if (field.isEater(this.x, this.y)) {
            this.state = State.DYING;
            return;
        }

        return applyEntityMovement(this, field);
    }

    draw() {
        let char = 'o';

        switch (this.state) {
            case State.SPAWNING:
                char = SPAWN_FRAMES$1[this.spawnStep];
                break;
            case State.DYING:
                char = DEATH_FRAMES$1[this.deathStep];
                break;
            case State.DEAD:
                return;
        }

        Screen.write(this.x, this.y, char);
    }
}

/**
 * `Ghost` is a class representing the Chaser enemy, which slowly pursues the player.
 */


const SPAWN_FRAMES = ['W', 'w', 'W', 'w', 'W', 'w', '.', '.', '.'];
const DEATH_FRAMES = ['.', ':', '.'];

class Ghost {
    constructor(dispenser) {
        this.x = dispenser.x;
        this.y = dispenser.y;
        this.state = State.SPAWNING;
        this.spawnStep = 0;
        this.deathStep = 0;
        // Move ghost every N frames
        this.moveCounter = 0;
        this.moveSpeed = 8;
    }

    update(field, moveFrame) {
        if (this.state === State.DYING) {
            this.deathStep++;
            if (this.deathStep >= DEATH_FRAMES.length) this.state = State.DEAD;
        }

        if (this.state === State.SPAWNING) {
            this.spawnStep++;
            if (this.spawnStep >= SPAWN_FRAMES.length) {
                this.state = State.LEFT; // just an active state marker
            }
        }

        if (this.state === State.SPAWNING || this.state === State.DYING || this.state === State.DEAD) return;

        if (!moveFrame) return;

        this.moveCounter++;
        if (this.moveCounter >= this.moveSpeed) {
            this.moveCounter = 0;

            // Move toward player
            let dx = field.player.x - this.x;
            let dy = field.player.y - this.y;

            let tryMove = (newX, newY) => {
                if (newX >= 0 && newX < LEVEL_COLS && newY >= 0 && newY < LEVEL_ROWS) {
                    let char = field.layout[newY][newX];
                    // Avoid solid tiles
                    if (!['=', '|', '#', '-'].includes(char)) {
                        this.x = newX;
                        this.y = newY;
                        return true;
                    }
                }
                return false;
            };

            // Determine primary direction
            if (Math.abs(dx) > Math.abs(dy)) {
                if (dx !== 0 && tryMove(this.x + Math.sign(dx), this.y)) return;
                if (dy !== 0 && tryMove(this.x, this.y + Math.sign(dy))) return;
            } else {
                if (dy !== 0 && tryMove(this.x, this.y + Math.sign(dy))) return;
                if (dx !== 0 && tryMove(this.x + Math.sign(dx), this.y)) return;
            }
        }
    }

    draw() {
        let char = 'W';

        switch (this.state) {
            case State.SPAWNING:
                char = SPAWN_FRAMES[this.spawnStep];
                break;
            case State.DYING:
                char = DEATH_FRAMES[this.deathStep];
                break;
            case State.DEAD:
                return;
        }

        Screen.write(this.x, this.y, char);
    }
}

var LevelData = [
	{
		name: "Easy Street",
		layout: [
			"                                       V                 $                     ",
			"                                                         H                     ",
			"                H                                        H                     ",
			"       =========H==================================================            ",
			"                H                                                              ",
			"                H                                                              ",
			"                H          H                             H                     ",
			"================H==========H==================   ========H=====================",
			"                &          H                             H          |       |  ",
			"                                                         H         Easy Street ",
			"                H                                        H                     ",
			"       =========H==========H=========  =======================                 ",
			"                H                                                              ",
			"                H                                                              ",
			"                H                                        H                     ",
			"======================== ====================== =========H==============       ",
			"                                                         H                     ",
			"    G     K    #                                         H                     ",
			"*    p         #                                         H                    *",
			"==============================================================================="
		]
	},
	{
		name: "Long Island",
		layout: [
			"                                                                          $    ",
			"                                                                   &      H    ",
			"    H       |V                                                     V|     H    ",
			"====H======================= ========================= ======================  ",
			"    H                                                                          ",
			"    H                                                                          ",
			"    H                    & |                         . .                  H    ",
			"========================== ======  =================== ===================H==  ",
			"                                                                          H    ",
			"                                  |                                       H    ",
			"    H                             |                 .  .                  H    ",
			"====H=====================   ======  ================  ======================  ",
			"    H                                                                          ",
			"    H                      |                                                   ",
			"    H                      |                        .   .                 H    ",
			"=========================  ========    ==============   ==================H==  ",
			"                                                                          H    ",
			"==============                      |                                     H    ",
			" Long Island |   p         *        |                 *                   H    ",
			"==============================================================================="
		]
	},
	{
		name: "Ghost Town",
		layout: [
			"                            V               V           V               $      ",
			"                                                                       $$$     ",
			"     p    H                                                    H      $$$$$   H",
			"==========H===                                                =H==============H",
			"          H                                                    H              H",
			"          H                              &                     H              H",
			"     ==============   ====     =    ======    =   ====    =====H=====         H",
			"    G              ^^^    ^^^^^ ^^^^      ^^^^ ^^^    ^^^                     $",
			"    h                                                                 |        ",
			"    o     |                     H                             &       |        ",
			"    s     ======================H============================== ===========    ",
			"    t        &                  H                                              ",
			"                                H                                              ",
			"              |                 H                 H                   H        ",
			"    T         ==================H=================H===================H======= ",
			"    o                                             H                   H        ",
			"    w                                                                 H        ",
			"    n                           ^                                     H        ",
			"*                              ^^^                                    H       *",
			"==============================================================================="
		]
	},
	{
		name: "Tunnel Vision",
		layout: [
			"                                            V                       V          ",
			"                                                                               ",
			"     H             H                         |                H                ",
			"=====H=====--======H==========================     ===----====H===========     ",
			"     H             H                |&&                       H                ",
			"     H             H                ==================        H                ",
			"     H             H                       tunnel  H          H                ",
			"     H           =======---===----=================H=         H           H    ",
			"     H         |                           vision  H          H           H    ",
			"     H         =========---&      -----============H          H           H    ",
			"     H           H                                 H |        H           H    ",
			"     H           H=========----===----================        H  ==============",
			"                 H                                        &   H                ",
			"                 H                                        |   H                ",
			"====---====      H                                        |   H                ",
			"|         |    ================---===---===================   H                ",
			"|   ===   |                                                   H        H    p  ",
			"|    $    |                                                   H     ===H=======",
			"|*  $$$  *|   *                *       *                     *H       *H       ",
			"==============================================================================="
		]
	},
	{
		name: "Point of No Return",
		time: 35,
		maxRocks: 7,
		layout: [
			"         $                                                                     ",
			"         H                                                   V                 ",
			"         H                                                                     ",
			"         HHHHHHHHHHHHH     .HHHHHHHHHHHHHH                          H    p     ",
			"         &                   V           H                        ==H==========",
			"                                         H                          H          ",
			"   H                                     H        .                 H          ",
			"===H==============-----------============H====                      H          ",
			"   H                                                      H         H          ",
			"   H                                                 =====H==============      ",
			"   H                                     H                H                    ",
			"   H              &..^^^.....^..^ . ^^   H==---------     H                    ",
			"   H         ============================H    &           H             H      ",
			"   H         ===      ===      ===       H    ---------=================H======",
			"   H                                     H                              H      ",
			"   H                          &          H          &                   H      ",
			"   ==========-------------------------=======----------===================     ",
			"                                                                               ",
			"^^^*         ^^^^^^^^^^^^^^^^^^^^^^^^^*     *^^^^^^^^^^*Point of No Return*^^^^",
			"==============================================================================="
		]
	},
	{
		name: "Bug City",
		layout: [
			"        Bug City             HHHHHHHH                          V               ",
			"                           HHH      HHH                                        ",
			"   H                                          >mmmmmmmm                        ",
			"   H===============                   ====================          H          ",
			"   H              |=====       \\  /         V                  =====H==========",
			"   H                            \\/                                  H          ",
			"   H                                        | $                     H          ",
			"   H           H                            | H                     H          ",
			"   H       ====H=======          p          |&H    H                H          ",
			"   H           H             ======================H           ======          ",
			"   H           H      &|                           H                    H      ",
			"   H           H      &|                    H      H     }{        =====H====  ",
			"===H===&       H       =====================H      H                    H      ",
			"               H                            H      H                    H      ",
			"               H                            H      &                    H      ",
			"         ======H===   =======    H    <>    &                           H      ",
			"                                 H==========       =====     =     ============",
			"     }i{                         H                                             ",
			"*                                H                                            *",
			"==============================================================================="
		]
	},
	{
		name: "GangLand",
		layout: [
			"                    =Gang Land=                             V                  ",
			"                   ==      _  ==                                      .        ",
			"      p    H        |  [] |_| |                  &                    .  H     ",
			"===========H        |     |_| |       H         ===   ===================H     ",
			"      V    H        =============     H======                            H     ",
			"           H                          H                     &            H     ",
			"           H                          H                |    |            H     ",
			"    H      H        ^^^&&^^^ & ^  ^^^ H           H    |    =============H     ",
			"    H======H   =======================H===========H=====          &      H     ",
			"    H                                 H           H    |         &&&     H     ",
			"    H                                 H           H    |        &&&&&    H     ",
			"    H                                 H           H    |    =============H     ",
			"              =====------=================        H    |       $     $         ",
			"                                         |        H    |      $$$   $$$        ",
			"====------===                            |        H    |     $$$$$ $$$$$       ",
			"            |       =                    | =============    ============       ",
			"            |       $                     ^          &                         ",
			"            |^^^^^^^^^^^^^^      $ ^              ======                       ",
			"*                   .      &   ^ H*^                    ^  ^       ^^^^^^^^^^^^",
			"==============================================================================="
		]
	}
];

/**
 * `Level` is a singleton that handles logic related to loading levels. A "level"
 * is a bundle of data (like layout, dispensers, player position, etc.). When you
 * load a level, that data is used to initialize a new "playing field" -- this is
 * what the player moves around on and interacts with.
 *
 * (Naming things is hard, so it helps to make a decision and then stick to it
 * throughout your codebase. In this case, the decision is that a "level" is a
 * static block of data about a level the user COULD play, whereas a level being
 * actively played is called a playing field.)
 */


const Level = {
    LEVELS: LevelData,
    LEVEL_COUNT: LevelData.length,

    load(levelNumber) {
        // In the original Ladder, "level 7" was the last level, and continuing to
        // play looped you around to the beginning again (level 8 is Easy Street
        // again and so on, and so is level 15, etc.).
        let level = Level.LEVELS[levelNumber % Level.LEVELS.length];
        if (!level) throw new Error(`No such level number: ${levelNumber}`);

        // Perform some sanity checks on the level layout and extract useful info
        // like player start position and dispenser positions etc.

        let layout = level.layout.map(row => row.split(''));
        let dispensers = [];
        let ghostDispensers = [];
        let player;

        // Sanity check
        layout = layout.slice(0, LEVEL_ROWS);

        for (let y = 0; y < LEVEL_ROWS; y++) {
            // Sanity checks
            if (!layout[y]) layout[y] = [];
            layout[y] = layout[y].slice(0, LEVEL_COLS);

            for (let x = 0; x < LEVEL_COLS; x++) {
                // Sanity check
                if (!layout[y][x]) layout[y][x] = ' ';

                // Der Dispensers (V) and Ghost Dispensers (G) have behaviors, so it is convenient for us
                // to construct a list of them, but they are permanent parts of the layout, so we can
                // leave them as part of the level and draw them normally.

                if (layout[y][x] === 'V') {
                    dispensers.push({ x, y });
                }

                if (layout[y][x] === 'G') {
                    ghostDispensers.push({ x, y });
                }

                // Treasure ($), Statues (&), and the Lad (p) are transient - the player moves around and
                // can pick up the treasures and statues. That's why for these elements, we add them to
                // our lists AND we remove them from the "playing field", we'll draw them separately on
                // top of the layout.

                if (layout[y][x] === 'p') {
                    layout[y][x] = ' ';
                    player = { x, y };
                }

                // Everything else, like floors (=), walls (|), ladders (H) and fire (^), is part of the
                // layout. The Lad interacts with them, but we can handle that during our movement checks.
            }
        }

        return {
            name: level.name,
            layout,
            dispensers,
            ghostDispensers,
            player
        };
    }
};

/**
 * `PlayingField` is a class that represents a level that is actively being played on-screen.
 * A new one is created by the game session any time we start a new level.
 *
 * Level-specific stuff (like bonus time, dispensers, rocks, player position, etc.) is all
 * managed by the playing field.
 */


class PlayingField {
    constructor(levelNumber) {
        let level = Level.load(levelNumber);

        // Store level-related info
        this.layout = level.layout;
        this.dispensers = level.dispensers;
        this.ghostDispensers = level.ghostDispensers;
        this.time = 2000;

        // Initialize player
        this.player = new Player(level.player.x, level.player.y);

        // Initialize list of rocks (empty)
        this.rocks = [];
        
        // Initialize list of ghosts (empty)
        this.ghosts = [];

        // Not winning yet (while "winning" the player stops moving and we add up the bonus score)
        this.winning = false;
    }

    update(moveFrame) {
        // If we're already winning, keep counting down the bonus time, but
        // no more movement will happen on this level.
        if (this.winning) {
            Game.session.updateScore(SCORE_TREASURE);
            this.time -= 10;
            if (this.time < 0) Game.session.startNextLevel();
            return;
        }

        // Count down bonus time
        if (this.time > 0 && moveFrame) this.time--;

        let oldX = this.player.x, oldY = this.player.y;

        // Move player based on user input
        this.player.update(this, moveFrame);

        // Any time you move OFF of a disappearing floor, it goes away.
        if (oldX !== this.player.x && oldY === this.player.y) {
            if (this.isDisappearingFloor(oldX, oldY + 1)) {
                this.layout[oldY + 1][oldX] = ' ';
            }
        }

        // Check if player should be dead (before moving rocks)
        if (moveFrame) this.checkIfPlayerShouldDie(Game.session);

        // Move rocks
        for (let rock of this.rocks) rock.update(this, moveFrame);

        // Move ghosts
        for (let ghost of this.ghosts) ghost.update(this, moveFrame);

        // Check if player should be dead (after moving rocks)
        if (moveFrame) this.checkIfPlayerShouldDie(Game.session);

        if (moveFrame) {
            // Collect statues
            if (this.isStatue(this.player.x, this.player.y)) {
                logger.info({ x: this.player.x, y: this.player.y, levelNumber: Game.session.levelNumber }, 'Collected statue');
                this.layout[this.player.y][this.player.x] = ' ';
                Game.session.updateScore(SCORE_STATUE);
            }

            // Collect keys
            if (this.isKey(this.player.x, this.player.y)) {
                logger.info({ x: this.player.x, y: this.player.y, levelNumber: Game.session.levelNumber }, 'Collected key');
                this.layout[this.player.y][this.player.x] = ' ';
                Game.session.updateScore(SCORE_KEY);
                // Open all doors
                for (let y = 0; y < this.layout.length; y++) {
                    for (let x = 0; x < this.layout[y].length; x++) {
                        if (this.layout[y][x] === '#') {
                            this.layout[y][x] = ' ';
                        }
                    }
                }
            }

            // Collect treasure (ends the current level)
            if (this.isTreasure(this.player.x, this.player.y)) {
                logger.info({ x: this.player.x, y: this.player.y, levelNumber: Game.session.levelNumber }, 'Collected treasure');
                this.winning = true;
                return;
            }

            // Interact with trampolines
            if (this.isTrampoline(this.player.x, this.player.y)) {
                switch (Math.floor(Math.random() * 5)) {
                    case 0:
                        this.player.state = State.LEFT;
                        this.player.nextState = undefined;
                        break;
                    case 1:
                        this.player.state = State.RIGHT;
                        this.player.nextState = undefined;
                        break;
                    case 2:
                        this.player.state = State.JUMP_UP;
                        this.player.nextState = undefined;
                        this.player.jumpStep = 0;
                        break;
                    case 3:
                        this.player.state = State.JUMP_LEFT;
                        this.player.nextState = State.LEFT;
                        this.player.jumpStep = 0;
                        break;
                    case 4:
                        this.player.state = State.JUMP_RIGHT;
                        this.player.nextState = State.RIGHT;
                        this.player.jumpStep = 0;
                        break;
                }
            }

            // Kill dead rocks
            this.rocks = this.rocks.filter(rock => rock.state !== State.DEAD);
            this.ghosts = this.ghosts.filter(ghost => ghost.state !== State.DEAD);

            // Dispense new rocks
            if (this.rocks.length < this.maxRocks() && Math.random() > 0.91) {
                let dispenser = this.dispensers[Math.floor(Math.random() * this.dispensers.length)];
                this.rocks.push(new Rock(dispenser));
            }
            
            // Dispense new ghosts
            if (this.ghosts.length < MAX_GHOSTS && this.ghostDispensers.length > 0 && Math.random() > 0.99) {
                let dispenser = this.ghostDispensers[Math.floor(Math.random() * this.ghostDispensers.length)];
                this.ghosts.push(new Ghost(dispenser));
            }

            // Dying player
            if (this.player.state === State.DEAD) {
                Game.session.lives--;
                if (Game.session.lives <= 0) {
                    // TODO: More fanfare
                    Game.showMainMenu();
                } else {
                    Game.session.restartLevel();
                }
            }
        }
    }

    draw() {
        // Draw layout
        Screen.write(0, 0, this.layout.map(row => row.join('')));

        // Draw player
        this.player.draw();

        // Draw rocks
        this.rocks.forEach(rock => rock.draw());

        // Draw ghosts
        this.ghosts.forEach(ghost => ghost.draw());
    }

    //
    // Utility functions - this is an attempt to consolidate logic in one spot and make other
    // functions (like the update logic in Player) more readable.
    //

    onSolid(x, y) {
        return ['=', '-', 'H', '|', '#'].includes(this.layout[y + 1][x]) || this.layout[y][x] === 'H';
    }

    emptySpace(x, y) {
        if (x < 0 || x >= LEVEL_COLS) {
            return false;
        } else {
            return !['|', '=', '#'].includes(this.layout[y][x]);
        }
    }

    isLadder(x, y) {
        return this.layout[y][x] === 'H';
    }

    isStatue(x, y) {
        return this.layout[y][x] === '&';
    }

    isTreasure(x, y) {
        return this.layout[y][x] === '$';
    }

    isKey(x, y) {
        return this.layout[y][x] === 'K';
    }

    isTrampoline(x, y) {
        return this.layout[y][x] === '.';
    }

    isEater(x, y) {
        return this.layout[y][x] === '*';
    }

    isFire(x, y) {
        return this.layout[y][x] === '^';
    }

    isDisappearingFloor(x, y) {
        return this.layout[y][x] === '-';
    }

    canClimbUp(x, y) {
        if (y < 0) return false;
        return ['H', '&', '$'].includes(this.layout[y][x]);
    }

    canClimbDown(x, y) {
        return ['H', '&', '$', ' ', '^', '.'].includes(this.layout[y][x]);
    }

    checkIfPlayerShouldDie() {
        // If we're ALREADY dying or dead, let nature run its course
        if (this.player.state === State.DYING || this.player.state === State.DEAD) return;

        // Landing on fire kills you
        if (this.isFire(this.player.x, this.player.y)) {
            logger.info({ x: this.player.x, y: this.player.y, levelNumber: Game.session.levelNumber }, 'Died from fire');
            this.player.kill();
        }

        // Running out of time kills you
        if (this.time <= 0) {
            logger.info({ x: this.player.x, y: this.player.y, levelNumber: Game.session.levelNumber }, 'Died from timeout');
            this.player.kill();
        }

        // Running into a rock kills you, and makes the rock that killed you disappear.
        // That's not necessary, I just think it looks better. While we play the death
        // animation we'll continue to move rocks, so another rock might also "hit" you,
        // but it will just pass through your dying character.
        //
        // If we're above a rock with 1 or 2 spaces between, we get some points instead.
        //
        // A function named `checkIfPlayerShouldDie` is probably not the best place to do
        // this, but it's convenient because we want to do this twice (just like the death
        // check).
        //
        //                    p                          p
        // (1)   p     -->            (2)   p     -->
        //        o          o                o          o
        //      =====       =====          =====       =====
        //
        // In situation (1), there will never be a frame on-screen where the player is directly
        // above the rock, but we'll still count it because we'll check once after the player moves.
        // In situation (2), the first check won't count, but the second check after the rocks move
        // will give the score (and the frame drawn on screen will show the player above the rock).
        //
        for (let i = 0; i < this.rocks.length; i++) {
            if (this.player.x === this.rocks[i].x) {
                if (this.player.y === this.rocks[i].y) {
                    logger.info({ 
                        px: this.player.x, 
                        py: this.player.y, 
                        rx: this.rocks[i].x, 
                        ry: this.rocks[i].y, 
                        levelNumber: Game.session.levelNumber 
                    }, 'Died from rock collision');
                    this.player.kill();
                    this.rocks.splice(i, 1);
                    break;
                } else if (this.player.y === this.rocks[i].y - 1 && this.emptySpace(this.player.x, this.player.y + 1)) {
                    Game.session.updateScore(SCORE_ROCK);
                } else if (this.player.y === this.rocks[i].y - 2 && this.emptySpace(this.player.x, this.player.y + 1) && this.emptySpace(this.player.x, this.player.y + 2)) {
                    Game.session.updateScore(SCORE_ROCK);
                }
            }
        }

        for (let i = 0; i < this.ghosts.length; i++) {
            if (this.player.x === this.ghosts[i].x && this.player.y === this.ghosts[i].y) {
                logger.info({ 
                    px: this.player.x, 
                    py: this.player.y, 
                    gx: this.ghosts[i].x, 
                    gy: this.ghosts[i].y, 
                    levelNumber: Game.session.levelNumber 
                }, 'Died from ghost collision');
                this.player.kill();
                this.ghosts.splice(i, 1);
                break;
            }
        }
    }

    maxRocks() {
        // The total number of rocks we can have on screen is based on a global max rocks value,
        // then increased slightly by the number of dispensers on the level, then increased again
        // by a hidden difficulty factor (level cycles).
        return MAX_ROCKS + this.dispensers.length * DISPENSER_MAX_ROCKS + Game.session.hiddenFactor() * HIDDEN_FACTOR_MAX_ROCKS;
    }
}

/**
 * `GameSession` is a class that represents... well, a game session! It is created when the
 * player presses `P` at the main menu, and ends when the player runs out of lives.
 *
 * The game session tracks values that persist across levels (like number of lives, score,
 * the level number, etc.). Most of the actual in-game logic it hands off to `PlayingField`.
 */


class GameSession {
    constructor() {
        this.score = 0;
        this.levelNumber = 0;
        this.levelCycle = 1;
        this.lives = 5;
        this.nextLife = NEW_LIFE_SCORE;
        this.paused = false;
    }

    update() {
        // The `Game` controls the overall game loop, which runs at a fixed 60 frames per second.
        //
        // However, Ladder has the concept of "play speed" which the player can change at the main
        // menu, and it controls how fast the game runs. To accomplish that, we can do a second
        // frame gate here. This gate sets a flag called `moveFrame` IF things can move in this frame.
        //
        // We do it this way so that animations (like the play death animation, or the end-of-level
        // score animation) can run at the same speed no matter what the play speed is.
        let now = new Date().getTime();
        let lastFrame = this.lastFrame || 0;
        let moveFrame = false;

        if (now - lastFrame >= (this.nextFrame || 0)) {
            moveFrame = true;
            this.nextFrame = now + this.moveFrameMillisecondDelay();
        }

        if (this.paused && [Input.Action.PAUSE, Input.Action.RESUME].includes(Input.lastAction())) {
            this.paused = false;
            Input.consume();
        }

        if (!this.paused && Input.lastAction() === Input.Action.PAUSE) {
            this.paused = true;
            Input.consume();
        }

        if (this.paused) return;

        // If we haven't instantiated the playing field yet, create it now.
        if (!this.field) {
            this.field = new PlayingField(this.levelNumber);
            logger.info({ 
                levelNumber: this.levelNumber, 
                lives: this.lives, 
                score: this.score 
            }, 'Level started');
        }

        // Hand off to the playing field for actual in-game logic
        this.field.update(moveFrame);

        this.handleCheatCodes();
    }

    draw() {
        if (this.field) this.field.draw();

        let stat = [
            String(this.lives).padStart(2, ' '),
            String(this.levelNumber + 1).padStart(2, ' '),
            String(this.score).padStart(6, ' '),
            this.field ? String(this.field.time).padStart(4, ' ') : ''
        ];
        Screen.write(0, 21, `Lads   ${stat[0]}     Level   ${stat[1]}      Score   ${stat[2]}      Bonus time   ${stat[3]}`);

        if (this.paused) {
            Screen.write(0, 23, 'Paused - type ESCape or RETURN to continue.');
        }
    }

    restartLevel() {
        logger.info({ levelNumber: this.levelNumber, score: this.score, lives: this.lives }, 'Restarting level');
        this.field = undefined;
    }

    startNextLevel() {
        logger.info({ levelNumber: this.levelNumber, score: this.score }, 'Level completed');
        this.field = undefined;
        this.levelNumber++;
        if (this.levelNumber % Level.LEVEL_COUNT === 0) {
            this.levelCycle++;
        }
    }

    updateScore(scoreType) {
        let amount = 0;
        let source = 'unknown';
        switch (scoreType) {
            case SCORE_ROCK:
                amount = 200;
                source = 'rock';
                break;
            case SCORE_STATUE:
                amount = this.field.time;
                source = 'statue';
                break;
            case SCORE_TREASURE:
                // Added repeatedly after winning the level
                amount = 10;
                source = 'bonus';
                break;
        }
        this.score += amount;
        logger.info({ 
            amount, 
            source, 
            total: this.score, 
            levelNumber: this.levelNumber 
        }, 'Score updated');

        if (this.score >= this.nextLife) {
            this.lives++;
            logger.info({ totalLives: this.lives }, 'Extra life awarded');
            this.nextLife += NEW_LIFE_SCORE;
        }
    }

    hiddenFactor() {
        // This "hidden" difficulty level increases steadily as the player completes a
        // level cycle (every time they reach the Easy Street level). This makes the
        // game slowly harder as you keep playing.
        return Math.floor(this.levelNumber / Level.LEVEL_COUNT);
    }

    moveFrameMillisecondDelay() {
        // Regardless of play speed, the game gets slightly faster every level cycle
        return Math.floor(PLAY_SPEEDS[Game.playSpeed] - this.hiddenFactor() * HIDDEN_FACTOR_PLAY_SPEED * PLAY_SPEEDS[Game.playSpeed]);
    }

    handleCheatCodes() {
        // Cheat codes are useful for testing, and this game is no exception. Of course
        // THESE cheat codes do not belong here, as they wouldn't be created until 11 years
        // later, but that won't stop me from using them anywhere I get the chance!
        //
        // =================     ===============     ===============   ========  ========
        // \\ . . . . . . .\\   //. . . . . . .\\   //. . . . . . .\\  \\. . .\\// . . //
        // ||. . ._____. . .|| ||. . ._____. . .|| ||. . ._____. . .|| || . . .\/ . . .||
        // || . .||   ||. . || || . .||   ||. . || || . .||   ||. . || ||. . . . . . . ||
        // ||. . ||   || . .|| ||. . ||   || . .|| ||. . ||   || . .|| || . | . . . . .||
        // || . .||   ||. _-|| ||-_ .||   ||. . || || . .||   ||. _-|| ||-_.|\ . . . . ||
        // ||. . ||   ||-'  || ||  `-||   || . .|| ||. . ||   ||-'  || ||  `|\_ . .|. .||
        // || . _||   ||    || ||    ||   ||_ . || || . _||   ||    || ||   |\ `-_/| . ||
        // ||_-' ||  .|/    || ||    \|.  || `-_|| ||_-' ||  .|/    || ||   | \  / |-_.||
        // ||    ||_-'      || ||      `-_||    || ||    ||_-'      || ||   | \  / |  `||
        // ||    `'         || ||         `'    || ||    `'         || ||   | \  / |   ||
        // ||            .===' `===.         .==='.`===.         .===' /==. |  \/  |   ||
        // ||         .=='   \_|-_ `===. .==='   _|_   `===. .===' _-|/   `==  \/  |   ||
        // ||      .=='    _-'    `-_  `='    _-'   `-_    `='  _-'   `-_  /|  \/  |   ||
        // ||   .=='    _-'          `-__\._-'         `-_./__-'         `' |. /|  |   ||
        // ||.=='    _-'                                                     `' |  /==.||
        // =='    _-'                                                            \/   `==
        // \   _-'                                                                `-_   /
        //  `''                                                                      ``'
        //
        let recentKeystrokes = Input.history.map(event => event.key).join('').toUpperCase();
        if (recentKeystrokes.match(/IDCLEV(\d\d)/)) {
            // Changing levels is as simple as setting the desired level number
            // and then throwing the current playing field away.
            Input.consume(true);
            this.levelNumber = parseInt(RegExp.$1, 10);
            this.field = undefined;
        } else if (recentKeystrokes.includes('IDDQD')) {
            Input.consume(true);
            logger.info('God mode activated');
        } else if (recentKeystrokes.includes('IDKFA')) {
            // Immediately end the current level as if we'd touched the treasure.
            Input.consume(true);
            if (this.field) this.field.winning = true;
        } else if (recentKeystrokes.includes('IDKILL')) {
            Input.consume(true);
            if (this.field && this.field.player) this.field.player.kill();
        }
    }
}

/**
 * `Game` is a singleton that represents the running game in the browser,
 * initializes game submodules, and handles the top-level game loop.
 */


const Game = {
    init() {
        Sprite.loadSpritesheet(async () => {
            await Viewport.init();
            await Screen.init();
            await Sprite.init();
            await Text.init();
            await Input.init();
            await Audio.init();

            window.addEventListener('blur', () => this.lostFocus());
            window.addEventListener('focus', () => this.gainedFocus());

            this.start();
        });
    },

    start() {
        this.frame = 0;
        this.playSpeed = 2;
        this.showMainMenu();

        window.requestAnimationFrame(() => this.onFrame());
    },

    onFrame() {
        let fps = 60;
        let now = new Date().getTime();
        let lastFrame = this.lastFrame || 0;

        // Note: we are using `requestAnimationFrame`, which will call our onFrame handler
        // 60 times per second in most cases. However, it can be higher (the browser may
        // respect the user's refresh settings, which could be 120Hz or higher for example).
        //
        // It's safest to have a check like we do here, where we explicitly limit the number
        // of update calls to 60 times per second.
        if (now - lastFrame >= 1000 / fps) {
            this.frame++;
            this.update();
            this.lastFrame = now;
        }
        this.draw();

        window.requestAnimationFrame(() => this.onFrame());
    },

    update() {
        // Pull in frame by frame button pushes / keypresses / mouse clicks
        Input.update();

        if (this.menu) {
            this.menu.update();
        }

        if (this.session) this.session.update();
    },

    draw() {
        // Reset canvas transform and scale
        Viewport.ctx.setTransform(Viewport.scale, 0, 0, Viewport.scale, 0, 0);

        // Clear canvas. Note we don't go for pure black but rather a dark gray, to simulate
        // the relatively bright phosphors on the Kaypro II. (We are going to add scan lines
        // at the end which will appear to darken the whole screen, so the overall effect
        // will be a little darker than this color.)
        Viewport.ctx.fillStyle = '#181818';
        Viewport.ctx.fillRect(0, 0, Viewport.width, Viewport.height);

        // Center the 80x25 character "screen" in the viewport
        Viewport.ctx.translate((Viewport.width - GAME_WIDTH) / 2 | 0, (Viewport.height - GAME_HEIGHT) / 2 | 0);

        // Hand off control to our submodules to draw whatever they'd like. For all the submodules
        // below us, "drawing" means writing text to the Screen.
        Screen.clear();
        if (this.session) this.session.draw();
        if (this.menu) this.menu.draw();

        // Render the text on the screen to the viewport.
        Screen.draw(Viewport.ctx);

        // After drawing the "screen" (characters), add scan lines on top. Our scan lines are almost
        // not visible, but move slowly and introduce subtle visual shifts in the characters on screen,
        // which is the effect we are going for.
        //
        // (Technically scan lines should be IN BETWEEN rows of pixels, and what we're actually simulating
        // here is our eyeballs clocking the screen refresh. We're going for a general feeling here.)
        Viewport.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        for (let y = Math.floor(-1600 / 2) - 4; y < Viewport.height + 4; y += 4) {
            let r = ((this.frame / 5) % 4) + y;
            Viewport.ctx.fillRect(-2592, r, Viewport.width * 2, 2);
        }
    },

    startSession() {
        this.menu = undefined;
        this.session = new GameSession();

        // Hide the github link while in a game session
        document.getElementsByClassName('github-corner')[0].className = 'github-corner hidden';
    },

    showMainMenu() {
        this.menu = new MainMenu();
        this.session = undefined;

        // Show github link again when returning from a game
        document.getElementsByClassName('github-corner')[0].className = 'github-corner';
    },

    showInstructions() {
        this.menu = new InstructionsMenu();
        this.session = undefined;
    },

    lostFocus() {
        // If we lose focus (the user switched tabs, or tabbed away from the browser),
        // automatically pause the game session if there is one.
        if (this.session) this.session.paused = true;
    },

    gainedFocus() {
        // Do nothing - we'll let the user hit enter to resume playing.
    }
};

/**
 * ServerGame - Headless game host
 *
 * This module monkey-patches the Game singleton to run headlessly in Node.js
 * and exposes methods to control the game and get its state for remote clients.
 */


class ServerGame {
    constructor() {
        this._callbacks = [];
        this._gameInterval = null;
        this._setupGame();
    }

    _setupGame() {
        // Initialize the game state
        Game.frame = 0;
        Game.playSpeed = 2;
        Game.session = undefined;
        Game.menu = undefined;

        // Replace browser-only methods
        Game.showMainMenu = () => {
            Game.menu = new MainMenu();
            Game.session = undefined;
        };

        Game.startSession = () => {
            Game.menu = undefined;
            Game.session = new GameSession();
        };

        // Initialize modules
        Screen.init();
        Input.init();
        Audio.init();

        // Show main menu
        Game.showMainMenu();
    }

    start() {
        if (this._gameInterval) return;

        // Run game loop at 60 fps
        this._gameInterval = setInterval(() => {
            this._tick();
        }, 1000 / 60);
    }

    stop() {
        if (this._gameInterval) {
            clearInterval(this._gameInterval);
            this._gameInterval = null;
        }
    }

    _tick() {
        Game.frame++;

        // Update phase
        Input.update();
        if (Game.menu) Game.menu.update();
        if (Game.session) Game.session.update();

        // Draw phase
        Screen.clear();
        if (Game.session) Game.session.draw();
        if (Game.menu) Game.menu.draw();
        // Note: Screen.draw(ctx) NOT called - no canvas on server

        // Emit frame snapshot to all listeners
        const snapshot = this.snapshot();
        this._callbacks.forEach(cb => cb(snapshot));
    }

    snapshot() {
        // Convert Screen.screen from 2D array to array of strings
        const screenArray = Screen.screen.map(row => row.join(''));

        return {
            frame: Game.frame,
            screen: screenArray,
            session: Game.session ? {
                score: Game.session.score || 0,
                lives: Game.session.lives || 0,
                level: Game.session.level || 0,
                paused: Game.session.paused || false
            } : null
        };
    }

    _findPlayer() {
        if (!Screen.screen) return { x: -1, y: -1 };
        const playerChars = ['p', 'q', 'g', 'b'];
        for (let y = 0; y < Screen.screen.length; y++) {
            for (let x = 0; x < Screen.screen[y].length; x++) {
                if (playerChars.includes(Screen.screen[y][x])) {
                    return { x, y, char: Screen.screen[y][x] };
                }
            }
        }
        return { x: -1, y: -1 };
    }

    _getHazards() {
        if (!Game.session || !Game.session.field) return { rocks: [], ghosts: [] };
        return {
            rocks: Game.session.field.rocks.map(r => ({ x: r.x, y: r.y })),
            ghosts: Game.session.field.ghosts.map(g => ({ x: g.x, y: g.y }))
        };
    }

    injectAction(actionName) {
        // Map action name to Input.Action code
        if (!(actionName in Input.Action)) {
            throw new Error(`Unknown action: ${actionName}`);
        }

        const pos = this._findPlayer();
        const hazards = this._getHazards();
        logger.info({ 
            action: actionName, 
            px: pos.x, 
            py: pos.y, 
            hazards,
            levelNumber: Game.session ? Game.session.levelNumber : -1 
        }, 'Injecting action');
        const actionCode = Input.Action[actionName];
        Input.buffer.push({
            at: new Date().getTime(),
            key: actionName,
            code: actionName,
            action: actionCode
        });
    }

    injectKey(key, code) {
        const pos = this._findPlayer();
        const hazards = this._getHazards();
        logger.info({ 
            key, 
            code: code || key, 
            px: pos.x, 
            py: pos.y,
            hazards,
            levelNumber: Game.session ? Game.session.levelNumber : -1
        }, 'Injecting key');
        Input.buffer.push({
            at: new Date().getTime(),
            key: key,
            code: code || key,
            action: Input.KeyMapping[code || key] || Input.Action.STOP
        });
    }

    onFrame(callback) {
        this._callbacks.push(callback);
    }

    removeFrameCallback(callback) {
        const idx = this._callbacks.indexOf(callback);
        if (idx >= 0) {
            this._callbacks.splice(idx, 1);
        }
    }
}

/**
 * HttpServer - Express app + WebSocket server
 *
 * Provides REST API and WebSocket interface for remote game control and state observation.
 */


// Get the directory of the current file (dist directory when bundled)
path.resolve(process.cwd(), 'dist');

async function startServer(port = 3000) {
    const app = express();
    const server = createServer(app);
    const wss = new WebSocketServer({ server });

    // Middleware
    app.use(express.json());
    app.use(express.static(path.resolve(process.cwd()), { index: false }));

    // Initialize game
    const game = new ServerGame();
    game.start();

    // Track connected WebSocket clients
    const wsClients = new Set();

    // WebSocket server
    wss.on('connection', (ws) => {
        wsClients.add(ws);

        // Send initial state
        ws.send(JSON.stringify({
            type: 'frame',
            ...game.snapshot()
        }));

        // Listen for input from client
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                if (message.type === 'input' && message.action) {
                    game.injectAction(message.action);
                } else if (message.type === 'key' && message.key) {
                    game.injectKey(message.key, message.code);
                }
            } catch (e) {
                console.error('WebSocket message error:', e);
            }
        });

        ws.on('close', () => {
            wsClients.delete(ws);
        });

        ws.on('error', (err) => {
            console.error('WebSocket error:', err);
        });
    });

    // Broadcast frames to all WebSocket clients
    game.onFrame((snapshot) => {
        const message = JSON.stringify({
            type: 'frame',
            ...snapshot
        });

        wsClients.forEach((ws) => {
            if (ws.readyState === 1) { // OPEN
                ws.send(message);
            }
        });
    });

    // REST API: GET /api/state
    app.get('/api/state', (req, res) => {
        res.json(game.snapshot());
    });

    // REST API: POST /api/input
    app.post('/api/input', (req, res) => {
        try {
            const { action } = req.body;
            if (!action) {
                return res.status(400).json({ error: 'action field required' });
            }
            if (!(action in Input.Action)) {
                return res.status(400).json({ error: `unknown action: ${action}` });
            }
            game.injectAction(action);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Static files: browser viewer and original game
    app.get('/', (req, res) => {
        res.sendFile(path.resolve(process.cwd(), 'client.html'));
    });

    app.get('/game', (req, res) => {
        res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });

    // Fallback - serve from dist
    app.use(express.static(path.resolve(process.cwd(), 'dist')));

    return new Promise((resolve) => {
        server.listen(port, () => {
            console.log(`Server running at http://localhost:${port}`);
            console.log(`  - WebSocket:     ws://localhost:${port}`);
            console.log(`  - Browser:       http://localhost:${port}`);
            console.log(`  - Original game: http://localhost:${port}/game`);
            console.log(`  - REST API:      http://localhost:${port}/api/state`);
            resolve(server);
        });
    });
}

/**
 * server.js - Entry point for headless Node.js server
 *
 * Starts the HTTP/WebSocket server that hosts a playable game instance.
 */


const port = process.env.PORT || 3000;
startServer(port).catch(err => {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
});
