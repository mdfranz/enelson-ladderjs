# /// script
# dependencies = [
#   "websockets",
# ]
# ///

import asyncio
import json
import websockets
import sys
import logging
from datetime import datetime


class JSONFormatter(logging.Formatter):
    """Custom formatter to output logs in JSON format."""
    def format(self, record):
        log_data = {
            "timestamp": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "msg": record.getMessage(),
        }
        if hasattr(record, "extra_data"):
            log_data.update(record.extra_data)
        return json.dumps(log_data)


class BotConfig:
    """Named constants for bot behavior."""
    WS_URL = "ws://localhost:3000"

    PLAYER_CHARS = {'p', 'q', 'g', 'b'}
    ROCK_CHARS = {'o', 'v'}
    GHOST_CHARS = {'u'}

    # Tile characters
    LADDER = 'H'
    CLIMBABLE_CHARS = {'H', '&', '$'}
    SOLID_CHARS = {'=', '|', '-'}
    EMPTY_CHARS = {' ', 'R', 'G'}

    # Hazard thresholds (in tiles)
    H_THREAT_DIST = 9          # horizontal threat detection distance
    H_DODGE_DIST = 6           # minimum distance before dodge triggers
    OVERHEAD_COLS = 2          # how many columns away is "overhead"?
    GHOST_THREAT_DIST = 8      # ghost threat detection distance
    DODGE_COOLDOWN = 15        # frames before dodge is available again


class GameState:
    """Single-frame snapshot of game state. Parse once per frame."""

    def __init__(self, frame):
        self.frame = frame
        self.player_x = -1
        self.player_y = -1
        self.player_char = ''
        self.rocks = []
        self.ghosts = []
        self.ladders = []
        self.keys = []
        self.dispensers = []
        self.level = frame.get("session", {}).get("level", 0)
        self._prev_player_x = -1
        self._prev_player_y = -1

        self._parse()

    def _parse(self):
        """Scan frame["screen"] and populate entities."""
        screen = self.frame.get("screen", [])
        for y, row in enumerate(screen):
            for x, char in enumerate(row):
                if char in BotConfig.PLAYER_CHARS:
                    self.player_x, self.player_y, self.player_char = x, y, char
                elif char in BotConfig.ROCK_CHARS:
                    self.rocks.append({"x": x, "y": y})
                elif char in BotConfig.GHOST_CHARS:
                    self.ghosts.append({"x": x, "y": y})
                elif char in BotConfig.CLIMBABLE_CHARS:
                    self.ladders.append({"x": x, "y": y})
                elif char == 'R':
                    self.dispensers.append({"x": x, "y": y, "type": "rock"})
                elif char == 'G':
                    self.dispensers.append({"x": x, "y": y, "type": "ghost"})
                elif char == 'K':
                    self.keys.append({"x": x, "y": y})

    @property
    def player_found(self):
        """Player was located on screen."""
        return self.player_x >= 0 and self.player_y >= 0

    @property
    def is_falling(self):
        """Player is currently falling (next to ground but not on it)."""
        screen = self.frame.get("screen", [])
        return (self.player_y + 1 < len(screen) and
                self.char_at(self.player_x, self.player_y + 1) == ' ')

    @property
    def is_stopped(self):
        """Player appears to be stationary."""
        return self.player_char in {'p', 'b'}

    def respawned(self, prev_state):
        """Detect if player was reset to spawn (5, 18)."""
        if prev_state is None:
            return False
        # Respawn detected if player is at spawn and was previously further away
        return (self.player_x == 5 and self.player_y == 18 and
                (prev_state.player_x > 6 or prev_state.player_y < 17))

    def char_at(self, x, y):
        """Safe accessor for screen[y][x]."""
        screen = self.frame.get("screen", [])
        if 0 <= y < len(screen) and 0 <= x < len(screen[y]):
            return screen[y][x]
        return ' '

    def ladder_cols(self):
        """Return set of x-columns containing ladder tiles."""
        return {ladder["x"] for ladder in self.ladders}

    def is_on_ladder(self):
        """Player is on a ladder tile that can initiate a climb."""
        return self.char_at(self.player_x, self.player_y) == BotConfig.LADDER

    def ladder_above(self, x, y):
        """Is there a ladder tile directly above (y-1)."""
        return self.char_at(x, y - 1) == BotConfig.LADDER


class HazardDetector:
    """Detects rock and ghost threats; suggests evasion actions."""

    def __init__(self):
        self._prev_rocks = []
        self.dodge_cooldown = 0

    def update(self, state):
        """Check for hazards; return action to override navigator, or None."""
        self.dodge_cooldown = max(0, self.dodge_cooldown - 1)

        # Skip hazard avoidance at spawn area (x <= 10) to let bot escape
        if state.player_x <= 10:
            self._prev_rocks = state.rocks
            return None

        # Enrich rocks with velocity and relative position
        self._annotate_rocks(state)

        # Priority 1: check for rocks
        rock_action = self._check_rocks(state)
        if rock_action:
            return rock_action

        # Priority 2: check for ghosts
        ghost_action = self._check_ghosts(state)
        if ghost_action:
            return ghost_action

        self._prev_rocks = state.rocks
        return None

    def _annotate_rocks(self, state):
        """Add velocity (vx, vy) and relative position (dx, dy) to rocks."""
        for rock in state.rocks:
            # Match rock to previous frame by proximity
            prev = self._find_prev_rock(rock)
            rock["vx"] = rock["x"] - prev["x"] if prev else 0
            rock["vy"] = rock["y"] - prev["y"] if prev else 0
            rock["dx"] = rock["x"] - state.player_x
            rock["dy"] = rock["y"] - state.player_y

    def _find_prev_rock(self, rock):
        """Find closest rock from previous frame (proxy for identity)."""
        if not self._prev_rocks:
            return {"x": rock["x"], "y": rock["y"]}

        candidates = [
            pr for pr in self._prev_rocks
            if abs(pr["x"] - rock["x"]) <= 1 and abs(pr["y"] - rock["y"]) <= 1
        ]

        if candidates:
            return min(candidates, key=lambda pr: abs(pr["x"] - rock["x"]) + abs(pr["y"] - rock["y"]))
        return {"x": rock["x"], "y": rock["y"]}

    def _check_rocks(self, state):
        """Analyze rock threats and suggest evasion (or None)."""
        if state.is_on_ladder() or self.dodge_cooldown > 0 or state.player_char == 'b':
            return None

        h_threats = [
            rock for rock in state.rocks
            if rock["dy"] == 0 and abs(rock["dx"]) <= BotConfig.H_THREAT_DIST
            and ((rock["dx"] > 0 and rock["vx"] <= 0) or
                 (rock["dx"] < 0 and rock["vx"] >= 0) or
                 abs(rock["dx"]) <= 2)
        ]

        # "Overhead" = rock directly above (1 row up), within horizontal range, and falling
        overhead = [
            rock for rock in state.rocks
            if rock["dy"] == -1 and abs(rock["dx"]) <= BotConfig.OVERHEAD_COLS
            and rock["vy"] > 0  # Only falling rocks, not stationary ones
        ]

        if not h_threats and not overhead:
            return None

        # Priority: overhead + horizontal threat → STOP
        if h_threats and overhead:
            closest = min(h_threats, key=lambda t: abs(t["dx"]))
            logging.warning("DANGER: Rock overhead AND horizontal. STOPPING.",
                            extra={"extra_data": {"rock_dx": closest["dx"], "overhead": True}})
            self.dodge_cooldown = BotConfig.DODGE_COOLDOWN
            return "STOP"

        # Horizontal threat only
        if h_threats:
            closest = min(h_threats, key=lambda t: abs(t["dx"]))
            if abs(closest["dx"]) <= BotConfig.H_DODGE_DIST:
                # Before jumping, check if rock is directly above (dy == -1)
                if any(rock["dx"] == closest["dx"] and rock["dy"] == -1 for rock in state.rocks):
                    # Don't jump into falling rock
                    logging.warning("DODGE: Rock horizontal, but rock overhead. Moving sideways.",
                                    extra={"extra_data": {"rock_dx": closest["dx"], "overhead": True}})
                    direction = "LEFT" if closest["dx"] > 0 else "RIGHT"
                    self.dodge_cooldown = BotConfig.DODGE_COOLDOWN
                    return direction

                logging.warning("DODGE: Rock horizontal. JUMPING.",
                                extra={"extra_data": {"rock_dx": closest["dx"]}})
                self.dodge_cooldown = BotConfig.DODGE_COOLDOWN
                return "JUMP"

        # Overhead only → move away from cluster centroid
        if overhead:
            centroid_x = sum(r["x"] for r in overhead) / len(overhead)
            direction = "LEFT" if state.player_x > centroid_x else "RIGHT"
            logging.warning(f"DANGER: Rock overhead. Moving {direction}.",
                            extra={"extra_data": {"overhead": True}})
            self.dodge_cooldown = BotConfig.DODGE_COOLDOWN
            return direction

        return None

    def _check_ghosts(self, state):
        """Analyze ghost threats and suggest evasion (or None)."""
        for ghost in state.ghosts:
            dx = ghost["x"] - state.player_x
            dy = ghost["y"] - state.player_y
            dist = abs(dx) + abs(dy)  # Manhattan distance

            # Adjacent: reverse direction
            if dist <= 1:
                direction = "LEFT" if dx > 0 else "RIGHT"
                logging.warning(f"GHOST ADJACENT: Reversing direction to {direction}.",
                                extra={"extra_data": {"ghost_dx": dx, "ghost_dy": dy}})
                return direction

            # Same row, approaching
            if dy == 0 and 0 < abs(dx) <= BotConfig.GHOST_THREAT_DIST:
                if (dx > 0 and ghost["x"] > state.player_x) or (dx < 0 and ghost["x"] < state.player_x):
                    logging.warning("GHOST APPROACH: Jumping away.",
                                    extra={"extra_data": {"ghost_dx": dx, "ghost_dy": dy}})
                    return "JUMP"

            # Skip ghost avoidance on ladders - let the player climb through ghosts
            # (they'll be handled after dismounting)

        return None


class Navigator:
    """Manages step-based navigation with ladder-alignment sub-state."""

    class Step:
        """Represents one navigation goal."""
        def __init__(self, name, action_fn, completion_fn):
            self.name = name
            self.action_fn = action_fn          # (state) -> action
            self.completion_fn = completion_fn  # (state) -> bool

    def __init__(self, steps):
        self.steps = steps
        self.current_step = 0
        self._align_state = None
        self._target_col = None
        self._respawn_handled = False  # Track whether we've already reset for this respawn

    def tick(self, state):
        """Advance navigation. Return action or None if step complete."""
        if self.current_step >= len(self.steps):
            return None

        step = self.steps[self.current_step]

        # Check completion
        if step.completion_fn(state):
            logging.info(f"[{step.name}] Complete at ({state.player_x}, {state.player_y}). Next step.")
            self.current_step += 1
            self._align_state = None
            self._target_col = None
            return "STOP"  # Clear intent buffer

        # Get action from step (steps now handle their own alignment)
        action = step.action_fn(state)
        return action

    def _align_then_climb(self, state):
        """
        Align player horizontally with ladder, then climb.
        Returns LEFT/RIGHT/UP or None.
        """
        # Initialize target on first UP
        if self._target_col is None:
            cols = state.ladder_cols()
            if not cols:
                logging.error("ERROR: No ladders found, but UP requested.")
                return None
            self._target_col = min(cols, key=lambda c: abs(c - state.player_x))
            logging.info(f"Alignment: targeting ladder at column {self._target_col}.")

        # Not yet aligned
        if state.player_x != self._target_col:
            if state.player_x < self._target_col:
                return "RIGHT"
            else:
                return "LEFT"

        # Aligned: check if ladder is present
        if state.is_on_ladder():
            return "UP"

        # Ladder above?
        if state.ladder_above(state.player_x, state.player_y):
            return "UP"

        # No ladder; stop alignment
        logging.error(f"ERROR: Aligned at {state.player_x} but no ladder.")
        self._align_state = None
        self._target_col = None
        return None

    def reset(self):
        """Called on respawn detection."""
        self.current_step = 0
        self._align_state = None
        self._target_col = None
        self._respawn_handled = True
        logging.info("Navigator reset on respawn.")

    def mark_away_from_spawn(self):
        """Called when player leaves spawn, allowing respawn detection again."""
        self._respawn_handled = False


def parse_time(ts_str):
    ts_str = ts_str.replace('Z', '+00:00')
    return datetime.fromisoformat(ts_str).timestamp()

def extract_paths():
    sessions = []
    current_session = []
    last_key = None
    
    try:
        with open('training_data.json', 'r') as f:
            for line in f:
                if not line.strip(): continue
                try: data = json.loads(line)
                except: continue
                
                key = (data.get('pid'), data.get('hostname'))
                is_new = last_key is not None and key != last_key
                if not is_new and current_session:
                    last_ts = parse_time(current_session[-1]['time'])
                    curr_ts = parse_time(data['time'])
                    if curr_ts - last_ts > 3600: is_new = True

                if is_new:
                    if current_session: sessions.append(current_session)
                    current_session = []
                
                current_session.append(data)
                last_key = key
                
        if current_session: sessions.append(current_session)
    except FileNotFoundError:
        logging.warning("No training_data.json found. Bot will not be able to learn paths.")
        return {}
    
    level_paths = {}
    for session in sessions:
        levels = {}
        for event in session:
            l = event.get('levelNumber')
            if l is not None and l >= 0:
                levels.setdefault(l, []).append(event)
                
        for l, events in levels.items():
            completed = any(e.get('msg') == 'Level completed' for e in events)
            if not completed: continue
                
            deaths = [i for i, e in enumerate(events) if 'Died' in e.get('msg', '')]
            start_idx = deaths[-1] + 1 if deaths else 0
            
            for i in range(start_idx, len(events)):
                if events[i].get('msg') in ('Level started', 'Restarting level'):
                    start_idx = i + 1
                    
            success_events = events[start_idx:]
            
            waypoints = []
            for i, e in enumerate(success_events):
                if 'px' not in e or 'py' not in e: continue
                code = e.get('code', '')
                msg = e.get('msg', '')
                
                if msg == 'Injecting key' and code in ['ArrowUp', 'ArrowDown']:
                    pos = {'x': e['px'], 'y': e['py'], 'action': 'CLIMB'}
                    if not waypoints or abs(waypoints[-1]['x'] - pos['x']) > 2 or abs(waypoints[-1]['y'] - pos['y']) > 2:
                        waypoints.append(pos)
                        
            # Ensure the final position (treasure) is recorded
            for e in reversed(success_events):
                 if 'px' in e and 'py' in e:
                     pos = {'x': e['px'], 'y': e['py'], 'action': 'GOAL'}
                     if not waypoints or abs(waypoints[-1]['x'] - pos['x']) > 2 or abs(waypoints[-1]['y'] - pos['y']) > 2:
                         waypoints.append(pos)
                     break
                     
            if l not in level_paths or len(waypoints) < len(level_paths[l]):
                level_paths[l] = waypoints
                
    return level_paths

def ladder_near(state, hint_col, threshold=10):
    """Helper: is there a ladder within threshold cols of hint_col?"""
    cols = state.ladder_cols()
    return any(abs(col - hint_col) <= threshold for col in cols)


def make_climb_action(target_x):
    """Factory for climb actions that know their target ladder column."""
    def climb_action(state):
        # Can we climb? (Must start on an 'H')
        if state.is_on_ladder() or state.ladder_above(state.player_x, state.player_y):
            # Check if there's actually something to climb INTO (can climb through H, &, $)
            if state.char_at(state.player_x, state.player_y - 1) in BotConfig.CLIMBABLE_CHARS:
                return "UP"
            # Otherwise, we are at the top of a ladder but it doesn't continue up.
            # If there's another ladder within jump reach, jump for it!
            if state.char_at(state.player_x, state.player_y - 2) == BotConfig.LADDER:
                return "JUMP"
            # Maybe we just need to dismount?
            return "STOP"

        # If we are at the target x but not on a ladder, we might need to jump to grab a broken one
        if state.player_x == target_x:
            # Check if there's a ladder above us within jump reach (up to 2 tiles)
            # Standing at y, JUMP reaches y-1 then y-2.
            if state.char_at(state.player_x, state.player_y - 1) == BotConfig.LADDER or \
               state.char_at(state.player_x, state.player_y - 2) == BotConfig.LADDER:
                return "JUMP"
            return "STOP"

        # Look for a ladder within ±3 columns of target
        closest_ladder = None
        closest_dist = float('inf')
        for dx in range(-3, 4):
            check_x = state.player_x + dx
            if state.char_at(check_x, state.player_y) == BotConfig.LADDER:
                dist = abs(dx)
                if dist < closest_dist:
                    closest_dist = dist
                    closest_ladder = check_x

        if closest_ladder is not None:
            # Found a ladder within 3 columns, move toward it
            if closest_ladder < state.player_x:
                return "LEFT"
            elif closest_ladder > state.player_x:
                return "RIGHT"
            else:
                # Shouldn't reach here since we checked is_on_ladder() above
                return "STOP"

        # No ladder nearby. Move toward target x-coordinate
        if state.player_x < target_x:
            return "RIGHT"
        elif state.player_x > target_x:
            return "LEFT"
        else:
            # At target but no ladder found, wait
            return "STOP"
    return climb_action

def make_climb_down_action(target_x):
    """Factory for climbing down."""
    def action(state):
        if state.player_x < target_x: return "RIGHT"
        if state.player_x > target_x: return "LEFT"
        return "DOWN"
    return action

def make_move_action(target_x):
    def action(state):
        if state.player_x < target_x: return "RIGHT"
        if state.player_x > target_x: return "LEFT"
        return "STOP"
    return action

def generate_steps_from_path(waypoints):
    """Generate Navigator steps dynamically from a list of waypoints."""
    steps = []
    
    for i, wp in enumerate(waypoints):
        target_x = wp['x']
        target_y = wp['y']
        action = wp['action']
        
        if action == 'CLIMB':
            # This waypoint represents starting to climb UP or DOWN.
            # Determine direction by looking at next waypoint if it exists.
            is_up = True
            if i + 1 < len(waypoints):
                if waypoints[i+1]['y'] > target_y:
                    is_up = False
            
            # Step 1: Move to X coordinate
            steps.append(Navigator.Step(
                name=f"Move to X={target_x} for climb {'UP' if is_up else 'DOWN'}",
                action_fn=make_move_action(target_x),
                completion_fn=lambda s, tx=target_x: s.player_x == tx
            ))
            
            # Step 2: Climb until Y condition met
            # The next waypoint tells us what Y we are climbing to
            if i + 1 < len(waypoints):
                next_y = waypoints[i+1]['y']
                if is_up:
                    steps.append(Navigator.Step(
                        name=f"Climb up to Y={next_y}",
                        action_fn=make_climb_action(target_x),
                        completion_fn=lambda s, ny=next_y: s.player_y <= ny
                    ))
                else:
                    steps.append(Navigator.Step(
                        name=f"Climb down to Y={next_y}",
                        action_fn=make_climb_down_action(target_x),
                        completion_fn=lambda s, ny=next_y: s.player_y >= ny
                    ))
                    
        elif action == 'GOAL':
            steps.append(Navigator.Step(
                name=f"Move to Goal X={target_x}",
                action_fn=make_move_action(target_x),
                completion_fn=lambda s, tx=target_x: s.player_x == tx
            ))
            steps.append(Navigator.Step(
                name=f"Climb to Goal Y={target_y}",
                action_fn=make_climb_action(target_x),
                completion_fn=lambda s, ny=target_y: s.player_y <= ny
            ))
            
    # Add a final step just in case
    steps.append(Navigator.Step(
        name="Finished Path",
        action_fn=lambda s: "STOP",
        completion_fn=lambda s: False
    ))
    
    return steps


def make_level1_steps():
    """Construct steps for Level 1 navigation, collecting statue and treasure."""

    steps = []

    # Step 1: Move to first ladder (x=57)
    # Collects Key at x=10, then jumps Door at x=15
    steps.append(Navigator.Step(
        name="Go to first ladder",
        action_fn=lambda state: "JUMP" if 12 <= state.player_x <= 14 else "RIGHT",
        completion_fn=lambda state: state.player_x >= 57 and state.player_y == 18
    ))

    # Step 2: Climb first ladder (x=57) to Platform 1 (y=14)
    steps.append(Navigator.Step(
        name="Climb first ladder",
        action_fn=make_climb_action(57),
        completion_fn=lambda state: state.player_y <= 14
    ))

    # Step 3: Move left to ladder 2 (x=16)
    steps.append(Navigator.Step(
        name="Move left to second ladder",
        action_fn=lambda state: "JUMP" if state.player_x in [49, 27] else "LEFT",
        completion_fn=lambda state: state.player_x <= 16
    ))

    # Step 4: Climb second ladder (x=16) to Platform 2 (y=11)
    steps.append(Navigator.Step(
        name="Climb second ladder",
        action_fn=make_climb_action(16),
        completion_fn=lambda state: state.player_y <= 11
    ))

    # Step 5: Move right to third ladder (x=27)
    steps.append(Navigator.Step(
        name="Move right to third ladder",
        action_fn=lambda state: "RIGHT",
        completion_fn=lambda state: state.player_x >= 27
    ))

    # Step 6: Climb third ladder (x=27) to Platform 3 (y=7)
    steps.append(Navigator.Step(
        name="Climb third ladder",
        action_fn=make_climb_action(27),
        completion_fn=lambda state: state.player_y <= 7
    ))

    # Step 7: Move left to statue location (x=16)
    steps.append(Navigator.Step(
        name="Move left to statue location",
        action_fn=lambda state: "LEFT",
        completion_fn=lambda state: state.player_x <= 16
    ))

    # Step 8: Get statue (&) by climbing down
    steps.append(Navigator.Step(
        name="Climb down for statue",
        action_fn=lambda state: "DOWN",
        completion_fn=lambda state: state.player_y >= 8
    ))

    # Step 9: Climb back up to platform 3 (y=7)
    steps.append(Navigator.Step(
        name="Climb back up to platform",
        action_fn=lambda state: "UP",
        completion_fn=lambda state: state.player_y <= 7
    ))

    # Step 10: Climb fourth ladder (x=16) to top platform (y=3)
    steps.append(Navigator.Step(
        name="Climb to top platform",
        action_fn=make_climb_action(16),
        completion_fn=lambda state: state.player_y <= 3
    ))

    # Step 11: Move right across top platform to final ladder (x=57)
    steps.append(Navigator.Step(
        name="Move right across top platform",
        action_fn=lambda state: "RIGHT",
        completion_fn=lambda state: state.player_x >= 57
    ))

    # Step 12: Stop at final ladder location
    steps.append(Navigator.Step(
        name="Stop at final ladder",
        action_fn=lambda state: "STOP",
        completion_fn=lambda state: state.player_char == 'g'
    ))

    # Step 13: Jump up to grab goal ladder
    steps.append(Navigator.Step(
        name="Jump up to grab goal ladder",
        action_fn=lambda state: "JUMP",
        completion_fn=lambda state: state.player_char == 'g' and state.player_y < 2
    ))

    # Step 14: Climb to goal and get treasure ($) at y=0
    steps.append(Navigator.Step(
        name="Climb to goal treasure",
        action_fn=make_climb_action(57),
        completion_fn=lambda state: state.player_y <= 0
    ))

    return steps


async def run_bot():
    """Main bot loop: frame-by-frame navigation + hazard avoidance."""
    
    # Configure logging
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler])

    url = BotConfig.WS_URL
    started = False
    last_action = None
    prev_state = None

    detector = HazardDetector()
    
    # Extract learned paths
    paths = extract_paths()
    if paths:
        logging.info(f"Learned paths for levels: {list(paths.keys())}")
    else:
        logging.warning("No learned paths available.")
        
    navigator = None
    current_nav_level = -1

    try:
        async with websockets.connect(url) as ws:
            logging.info("Bot connected to game server")

            async for message in ws:
                frame = json.loads(message)

                # Wait for session to start
                if not frame.get("session"):
                    if not started:
                        logging.info("Starting game...")
                        await ws.send(json.dumps({"type": "key", "key": "P"}))
                        started = True
                    continue

                # Parse current frame
                state = GameState(frame)
                
                # Check if we need to initialize or switch the navigator for the current level
                if state.level != current_nav_level:
                    if state.level in paths:
                        logging.info(f"Loading learned path for level {state.level}")
                        navigator = Navigator(generate_steps_from_path(paths[state.level]))
                    else:
                        logging.warning(f"No learned path for level {state.level}. Using hardcoded fallback.")
                        navigator = Navigator(make_level1_steps())
                    current_nav_level = state.level

                # Skip if no player on screen
                if not state.player_found:
                    prev_state = state
                    continue

                # Respawn detection (only reset once per respawn)
                if state.respawned(prev_state) and not navigator._respawn_handled:
                    logging.info("Player respawned. Resetting route...")
                    navigator.reset()
                elif state.player_x > 10:
                    # Player has moved away from spawn, allow respawn detection again
                    navigator.mark_away_from_spawn()

                # Hazard override
                action = detector.update(state)

                # Navigation (if no hazard)
                if action is None:
                    action = navigator.tick(state)

                # Send action: always send movement commands (for Pac-Man continuous motion),
                # and send state changes when they differ from last action
                if action:
                    is_movement = action in ["RIGHT", "LEFT", "UP", "DOWN"]
                    if is_movement or action != last_action:
                        logging.info(f"Action: {action}", extra={"extra_data": {
                            "action": action,
                            "px": state.player_x,
                            "py": state.player_y,
                            "pchar": state.player_char,
                            "step": navigator.current_step
                        }})
                        await ws.send(json.dumps({"type": "input", "action": action}))
                        last_action = action

                prev_state = state

    except Exception as e:
        logging.error(f"Error: {e}")


if __name__ == "__main__":
    asyncio.run(run_bot())
