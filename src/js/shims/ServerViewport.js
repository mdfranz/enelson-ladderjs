/**
 * ServerViewport - No-op stub for headless server environment
 * Replaces Viewport for server-side game execution
 */

import { GAME_WIDTH, GAME_HEIGHT } from '../Constants';

export const Viewport = {
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
