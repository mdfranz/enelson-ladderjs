/**
 * ServerGame - Headless game host
 *
 * This module monkey-patches the Game singleton to run headlessly in Node.js
 * and exposes methods to control the game and get its state for remote clients.
 */

import { Game } from './Game';
import { GameSession } from './GameSession';
import { MainMenu } from './MainMenu';
import { Input } from './Input';
import { Audio } from './Audio';
import { Screen } from './Screen';
import logger from './logger.js';

export class ServerGame {
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
        Audio.update();
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
