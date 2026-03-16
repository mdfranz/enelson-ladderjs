const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');

// Stateful goals for navigating Level 1
const steps = [
    {
        name: 'Go to first ladder',
        action: (px) => (px >= 12 && px <= 14) ? 'JUMP' : 'RIGHT', // Jump the door at x=15
        completion: (px, py) => px >= 57 && py === 18
    },
    {
        name: 'Climb first ladder',
        action: () => 'UP',
        completion: (px, py) => py <= 14
    },
    {
        name: 'Move left across platform 1',
        action: (px) => (px === 49 || px === 27) ? 'JUMP' : 'LEFT', // Safe jump zones for gaps
        completion: (px, py) => px <= 16 && py === 14
    },
    {
        name: 'Climb second ladder',
        action: () => 'UP',
        completion: (px, py) => py <= 11
    },
    {
        name: 'Move right across platform 2',
        action: () => 'RIGHT',
        completion: (px, py) => px >= 27 && py === 11
    },
    {
        name: 'Climb third ladder',
        action: () => 'UP',
        completion: (px, py) => py <= 7
    },
    {
        name: 'Move left across platform 3',
        action: () => 'LEFT',
        completion: (px, py) => px <= 16 && py === 7
    },
    {
        name: 'Climb fourth ladder',
        action: () => 'UP',
        completion: (px, py) => py <= 3
    },
    {
        name: 'Move right across top platform',
        action: () => 'RIGHT',
        completion: (px, py) => px >= 57 && py === 3
    },
    {
        name: 'Stop at final ladder',
        action: () => 'STOP',
        completion: (px, py, pchar) => pchar === 'g' 
    },
    {
        name: 'Jump up to grab goal ladder',
        action: () => 'JUMP',
        completion: (px, py, pchar) => pchar === 'g' && py < 3 
    },
    {
        name: 'Climb to goal',
        action: () => 'UP',
        completion: (px, py) => py <= 0
    }
];

let currentStep = 0;
let started = false;
let prevRocks = [];
let dodgeCooldown = 0;

ws.on('open', () => {
    console.log('Bot connected to game server');
});

ws.on('message', (data) => {
    const frame = JSON.parse(data);
    
    if (!frame.session) {
        if (!started) {
            console.log('Starting game...');
            ws.send(JSON.stringify({ type: 'key', key: 'P' }));
            started = true;
        }
        return;
    }

    if (frame.session.level > 1) {
        console.log('Level 1 complete! Exiting.');
        process.exit(0);
    }

    // Find entities
    let px = -1, py = -1, pchar = '';
    const playerChars = ['p', 'q', 'g', 'b']; 
    const rocks = [];

    for (let y = 0; y < frame.screen.length; y++) {
        for (let x = 0; x < frame.screen[y].length; x++) {
            const char = frame.screen[y][x];
            if (playerChars.includes(char)) {
                px = x; py = y; pchar = char;
            } else if (char === 'o' || char === 'v') {
                rocks.push({ x, y });
            }
        }
    }

    if (dodgeCooldown > 0) dodgeCooldown--;

    if (px !== -1) {
        // Reset check (Respawn)
        if (px === 5 && py === 18 && currentStep > 1) {
            console.log('Player respawned. Resetting route...');
            currentStep = 0;
            started = true;
        }

        let dodging = false;

        // Smart Dodge Logic
        const threats = rocks.map(rock => {
            const prev = prevRocks.find(pr => pr.y === rock.y && Math.abs(pr.x - rock.x) <= 2);
            const vx = prev ? rock.x - prev.x : 0;
            return { x: rock.x, y: rock.y, vx, dist: rock.x - px, dy: rock.y - py };
        });

        // Horizontal threats moving towards us
        const horizontalThreats = threats.filter(t => 
            t.dy === 0 && 
            Math.abs(t.dist) <= 7 && 
            ((t.dist > 0 && t.vx <= 0) || (t.dist < 0 && t.vx >= 0) || (t.vx === 0 && Math.abs(t.dist) <= 2))
        );

        // Overhead threats (dangerous if we jump)
        const overheadThreats = threats.filter(t => t.dy === -1 && Math.abs(t.dist) <= 2);

        if (dodgeCooldown === 0 && pchar !== 'b') {
            if (horizontalThreats.length > 0) {
                const closest = horizontalThreats.sort((a, b) => Math.abs(a.dist) - Math.abs(b.dist))[0];
                
                if (Math.abs(closest.dist) <= 5) {
                    if (overheadThreats.length > 0) {
                         console.log(`Emergency STOP: Rock overhead at x=${overheadThreats[0].x}. Waiting.`);
                         ws.send(JSON.stringify({ type: 'input', action: 'STOP' }));
                         dodging = true;
                    } else {
                         console.log(`Dodge JUMP: Rock closing at dist=${closest.dist} (vx=${closest.vx})`);
                         ws.send(JSON.stringify({ type: 'input', action: 'JUMP' }));
                         dodgeCooldown = 12;
                         dodging = true;
                    }
                }
            }
        }

        // Only process navigation if not in emergency dodge mode
        if (!dodging && currentStep < steps.length) {
            const step = steps[currentStep];
            if (step.completion(px, py, pchar)) {
                console.log(`[${step.name}] Complete! Next step.`);
                currentStep++;
            } else {
                const action = step.action(px, py, pchar);
                if (action) {
                    ws.send(JSON.stringify({ type: 'input', action: action }));
                }
            }
        }
    }

    prevRocks = rocks;
});

ws.on('error', (err) => console.error('WebSocket Error:', err));
ws.on('close', () => console.log('Connection closed.'));
