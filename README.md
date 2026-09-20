# CLI Music Player

A terminal music player for macOS, built with plain Node.js. Browse your
local mp3 files and play, pause, seek, and repeat/shuffle them without
leaving the terminal.

## Requirements

- macOS
- Node.js 18+
- `afplay` and `afinfo` - built into macOS, no install needed
- [VLC](https://www.videolan.org/vlc/) - optional. If it's installed at
  `/Applications/VLC.app`, the player uses it automatically (this unlocks
  seeking). Otherwise it falls back to `afplay`.

No npm packages are used - everything runs on Node's built-in modules.

## Running it

```
npm start
```

The `songs/` folder is empty on a fresh clone (only a `.gitkeep` file is
checked in) - drop your own `.mp3` files into it before running the player.

## Keys

| Key         | Action                                  |
| ----------- | ---------------------------------------- |
| `↑` / `↓`   | Move the cursor up/down the song list   |
| `Enter`     | Play the highlighted song               |
| `Space`     | Pause / resume                          |
| `s`         | Stop playback                           |
| `n`         | Next song                               |
| `b`         | Previous song                           |
| `r`         | Cycle repeat: off → one → all → off     |
| `h`         | Toggle shuffle on/off                   |
| `←` / `→`   | Seek back/forward 10s (VLC only)        |
| `q` / `Ctrl+C` | Quit                                 |

## Features

- **Dual playback backend** - uses VLC automatically when it's installed,
  otherwise falls back to macOS's built-in `afplay`.
- **Seeking** - jump 10 seconds back or forward (VLC only).
- **Colour progress bar** - a 40-character bar that shifts from green to
  yellow to red as the song progresses.
- **Live equaliser** - a 16-bar animation that reacts while playing and
  freezes when paused.
- **Repeat and shuffle** - repeat one song, repeat the whole list, or shuffle
  through it.
- **Auto-advance** - moves to the next song automatically when one ends.

## How it works

- **`spawn` and child processes** - `child_process.spawn` starts VLC or
  `afplay` as a separate OS process. The player never touches audio directly;
  it just starts, signals, and stops these external programs.
- **Controlling VLC through its stdin** - VLC is started with `--intf rc`,
  which opens a small text-command interface on its stdin. Writing commands
  like `pause`, `play`, `seek 30`, or `quit` there controls playback without
  needing a GUI.
- **Signals for the `afplay` fallback** - `afplay` has no such command
  interface, so pause/resume use `SIGSTOP`/`SIGCONT` to freeze and unfreeze
  the process in place (preserving its position in the file), and stopping
  sends `SIGCONT` then `SIGTERM` (a frozen process can't react to anything,
  including a terminate signal, until it's unfrozen first). `SIGKILL` is
  never used, since it can't be caught, and `afplay` wouldn't get the chance
  to release the audio device before dying.
- **Raw mode and reading key bytes** - `process.stdin.setRawMode(true)`
  delivers each keypress immediately as raw bytes instead of buffering a
  whole line until Enter. Arrow keys arrive as 3-byte escape sequences
  (`0x1b 0x5b <direction>`); everything else is a single byte compared
  numerically against its key code.
- **ANSI escape codes for drawing the screen** - the whole screen is redrawn
  in place every tick: `\x1B[H` moves the cursor home, `\x1B[0K` clears each
  row before it's rewritten, and colour codes like `\x1B[36m` tint text. This
  avoids the flicker of clearing and repainting the whole terminal, and the
  entire frame is built as one string and sent in a single
  `process.stdout.write` call.

## File structure

```
.
├── index.js        # State, key handling, and the playback/timer logic
├── src/
│   ├── player.js    # Backend control: spawn, play/pause/resume/stop
│   └── ui.js         # Renders the whole screen from the current state
├── songs/            # Your .mp3 files go here (empty on a fresh clone)
├── package.json
└── CLAUDE.md          # Coding rules followed throughout this project
```
