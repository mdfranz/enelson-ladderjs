/**
 * HttpServer - Express app + WebSocket server
 *
 * Provides REST API and WebSocket interface for remote game control and state observation.
 */

import express from 'express';
import path from 'path';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { ServerGame } from './ServerGame.js';
import { Input } from './Input.js';

// Get the directory of the current file (dist directory when bundled)
const __dirname = path.resolve(process.cwd(), 'dist');

export async function startServer(port = 3000) {
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
