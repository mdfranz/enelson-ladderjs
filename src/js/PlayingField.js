/**
 * `PlayingField` is a class that represents a level that is actively being played on-screen.
 * A new one is created by the game session any time we start a new level.
 *
 * Level-specific stuff (like bonus time, dispensers, rocks, player position, etc.) is all
 * managed by the playing field.
 */

import { LEVEL_COLS, SCORE_ROCK, SCORE_STATUE, SCORE_TREASURE, SCORE_KEY, MAX_ROCKS, MAX_GHOSTS, DISPENSER_MAX_ROCKS, HIDDEN_FACTOR_MAX_ROCKS } from './Constants';
import { Game } from './Game';
import { Player } from './Player';
import { Rock } from './Rock';
import { Ghost } from './Ghost';
import { State } from './Entity';
import { Screen } from './Screen';
import { Level } from './Level';
import { Audio } from './Audio';
import logger from './logger.js';

export class PlayingField {
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

        Audio.play(Audio.begin);
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
                Audio.play(Audio.score);
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
