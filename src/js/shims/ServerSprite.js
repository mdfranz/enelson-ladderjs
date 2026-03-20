/**
 * ServerSprite - Minimal stub for headless server environment
 * Replaces Sprite for server-side game execution
 */

export const Sprite = {
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
