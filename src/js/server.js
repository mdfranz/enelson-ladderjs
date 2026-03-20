/**
 * server.js - Entry point for headless Node.js server
 *
 * Starts the HTTP/WebSocket server that hosts a playable game instance.
 */

import { startServer } from './HttpServer.js';
import logger from './logger.js';

const port = process.env.PORT || 3000;
startServer(port).catch(err => {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
});
