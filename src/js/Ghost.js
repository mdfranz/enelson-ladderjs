/**
 * `Ghost` is a class representing the Chaser enemy, which slowly pursues the player.
 */

import { LEVEL_COLS, LEVEL_ROWS } from './Constants';
import { State } from './Entity';
import { Screen } from './Screen';

const SPAWN_FRAMES = ['W', 'w', 'W', 'w', 'W', 'w', '.', '.', '.'];
const DEATH_FRAMES = ['.', ':', '.'];

export class Ghost {
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
