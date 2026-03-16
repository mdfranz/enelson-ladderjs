/**
 * ServerAudio - No-op stub for headless server environment
 * Replaces Audio for server-side game execution
 */

export const Audio = {
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
