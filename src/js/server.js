/**
 * server.js - Entry point for headless Node.js server
 *
 * Starts the HTTP/WebSocket server that hosts a playable game instance.
 */

import { startServer } from './HttpServer.js';

const port = process.env.PORT || 3000;
startServer(port).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
