/**
 * ServerText - No-op stub for headless server environment
 * Replaces Text for server-side game execution
 */

import { CHAR_WIDTH, CHAR_HEIGHT } from '../Constants';

export const Text = {
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
