import json
import time
import curses
import sys
from datetime import datetime

def load_levels():
    try:
        with open('src/levels/levels.json', 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print("Error: src/levels/levels.json not found.")
        sys.exit(1)

def parse_time(ts_str):
    # format: "2026-03-17T23:10:01.267Z"
    ts_str = ts_str.replace('Z', '+00:00')
    return datetime.fromisoformat(ts_str).timestamp()

def get_sessions():
    sessions = []
    current_session = []
    last_key = None
    
    try:
        with open('training_data.json', 'r') as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                
                # Group by PID and Hostname
                key = (data.get('pid'), data.get('hostname'))
                
                # Start new session if PID/Host changes or if there is a massive time gap (> 1 hour)
                is_new = last_key is not None and key != last_key
                if not is_new and current_session:
                    last_ts = parse_time(current_session[-1]['time'])
                    curr_ts = parse_time(data['time'])
                    if curr_ts - last_ts > 3600:
                        is_new = True

                if is_new:
                    if current_session:
                        sessions.append(current_session)
                    current_session = []
                
                current_session.append(data)
                last_key = key
                
        if current_session:
            sessions.append(current_session)
    except FileNotFoundError:
        print("Error: training_data.json not found.")
        sys.exit(1)
        
    return sessions

def draw_frame(stdscr, level_data, player_x, player_y, rocks, ghosts, msg, stats):
    stdscr.erase()
    
    layout = level_data['layout']
    for y, row in enumerate(layout):
        try:
            stdscr.addstr(y, 0, row)
        except curses.error:
            pass
            
    for r in rocks:
        rx, ry = r['x'], r['y']
        if 0 <= ry < len(layout) and 0 <= rx < len(layout[0]):
            try:
                stdscr.addstr(ry, rx, 'O')
            except curses.error:
                pass
            
    for g in ghosts:
        gx, gy = g['x'], g['y']
        if 0 <= gy < len(layout) and 0 <= gx < len(layout[0]):
            try:
                stdscr.addstr(gy, gx, 'G')
            except curses.error:
                pass
            
    if player_x is not None and player_y is not None:
        if 0 <= player_y < len(layout) and 0 <= player_x < len(layout[0]):
            try:
                stdscr.addstr(player_y, player_x, 'p')
            except curses.error:
                pass
            
    try:
        info = f"Level: {level_data.get('name', 'Unknown')} | Score: {stats.get('score', 0)} | Lives: {stats.get('lives', 0)}"
        stdscr.addstr(len(layout) + 1, 0, info)
        stdscr.addstr(len(layout) + 2, 0, f"Event: {msg}")
        stdscr.addstr(len(layout) + 3, 0, "Press 'q' to quit replay")
    except curses.error:
        pass
        
    stdscr.refresh()

def run_replay(stdscr, session_data, levels):
    curses.curs_set(0)
    stdscr.nodelay(1)
    
    last_ts = None
    last_px = None
    last_py = None
    last_rocks = []
    last_ghosts = []
    stats = {'score': 0, 'lives': 0}
    
    for data in session_data:
        if stdscr.getch() == ord('q'):
            return

        level_idx = data.get('levelNumber')
        if level_idx is None:
            # Fallback for older log format where 'level' was used
            l = data.get('level')
            if isinstance(l, int) and l < 10: # Log levels are typically 30 (INFO)
                level_idx = l
        
        if level_idx is None or level_idx < 0 or level_idx >= len(levels):
            continue
            
        level_data = levels[level_idx]
        
        if 'px' in data: last_px = data['px']
        if 'py' in data: last_py = data['py']
        if 'score' in data: stats['score'] = data['score']
        if 'total' in data: stats['score'] = data['total']
        if 'lives' in data: stats['lives'] = data['lives']
        
        msg = data.get('msg', '')
        if 'hazards' in data:
            hazards = data['hazards']
            last_rocks = hazards.get('rocks', [])
            last_ghosts = hazards.get('ghosts', [])
        
        curr_ts = parse_time(data['time'])
        if last_ts is not None:
            delta = curr_ts - last_ts
            if delta > 0:
                # Replay at 1.5x speed for better flow
                time.sleep(min(delta / 1.5, 0.1))
        
        last_ts = curr_ts
        draw_frame(stdscr, level_data, last_px, last_py, last_rocks, last_ghosts, msg, stats)
            
    stdscr.nodelay(0)
    stdscr.addstr(len(levels[0]['layout']) + 4, 0, "Session finished. Press any key to exit.")
    stdscr.refresh()
    stdscr.getch()

if __name__ == "__main__":
    levels = load_levels()
    sessions = get_sessions()
    
    if not sessions:
        print("No valid sessions found in training_data.json")
        sys.exit(0)
        
    print(f"Found {len(sessions)} game sessions:\n")
    for i, s in enumerate(sessions):
        start = s[0]['time']
        end = s[-1]['time']
        pid = s[0].get('pid', 'N/A')
        host = s[0].get('hostname', 'N/A')
        events = len(s)
        print(f"[{i}] {start} -> {end}")
        print(f"    PID: {pid} | Host: {host} | Events: {events}\n")
        
    try:
        choice = input(f"Select a session to replay (0-{len(sessions)-1}) or 'q' to quit: ")
        if choice.lower() == 'q':
            sys.exit(0)
        idx = int(choice)
        if 0 <= idx < len(sessions):
            curses.wrapper(run_replay, sessions[idx], levels)
        else:
            print("Invalid selection.")
    except (ValueError, KeyboardInterrupt):
        print("\nExiting.")
