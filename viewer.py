# /// script
# dependencies = [
#   "websockets",
# ]
# ///

import asyncio
import json
import websockets
import curses
import sys

class Viewer:
    def __init__(self, stdscr):
        self.stdscr = stdscr
        self.url = "ws://localhost:3000"
        self.running = True
        self.frame_queue = asyncio.Queue(maxsize=1)
        
        # Initialize curses
        curses.curs_set(0)
        self.stdscr.nodelay(1)
        self.stdscr.keypad(True)
        self.stdscr.timeout(0) # Non-blocking input
        
    def draw_frame(self, frame):
        if not frame:
            return
        
        # Draw the screen
        screen = frame.get("screen") or []
        for y, row in enumerate(screen):
            try:
                # Use move + addstr to minimize cursor movement
                self.stdscr.move(y, 0)
                self.stdscr.clrtoeol()
                self.stdscr.addstr(y, 0, row)
            except curses.error:
                pass
                
        # Draw session info
        session = frame.get("session") or {}
        level = session.get('level', 'N/A')
        score = session.get('score', 0)
        lives = session.get('lives', 0)
        info = f"Level: {level} | Score: {score} | Lives: {lives}"
        
        try:
            row_idx = len(screen) + 1
            self.stdscr.move(row_idx, 0)
            self.stdscr.clrtoeol()
            self.stdscr.addstr(row_idx, 0, info)
            row_idx += 1
            self.stdscr.move(row_idx, 0)
            self.stdscr.clrtoeol()
            self.stdscr.addstr(row_idx, 0, "Press [q] to quit viewer")
        except curses.error:
            pass
            
        self.stdscr.refresh()

    async def input_loop(self):
        while self.running:
            key = self.stdscr.getch()
            if key == ord('q'):
                self.running = False
                break
            await asyncio.sleep(0.1)

    async def frame_loop(self, ws):
        async for message in ws:
            if not self.running:
                break
            frame = json.loads(message)
            # Use a non-blocking put to update the latest frame, skipping intermediate ones
            if self.frame_queue.full():
                try:
                    self.frame_queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            await self.frame_queue.put(frame)

    async def render_loop(self):
        while self.running:
            frame = await self.frame_queue.get()
            self.draw_frame(frame)

    async def run(self):
        try:
            async with websockets.connect(self.url) as ws:
                await asyncio.gather(
                    self.input_loop(),
                    self.frame_loop(ws),
                    self.render_loop()
                )
        except Exception as e:
            if self.running:
                self.stdscr.addstr(0, 0, f"Error: {e}")
                self.stdscr.addstr(1, 0, "Press any key to exit...")
                self.stdscr.refresh()
                self.stdscr.nodelay(0)
                self.stdscr.getch()

async def main(stdscr):
    viewer = Viewer(stdscr)
    await viewer.run()

if __name__ == "__main__":
    try:
        curses.wrapper(lambda stdscr: asyncio.run(main(stdscr)))
    except KeyboardInterrupt:
        pass
