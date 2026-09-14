const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const render = require('./src/ui');

console.log('Player is starting...');

// Songs live next to index.js so the player works from any cwd
const songsDir = path.join(__dirname, 'songs');

// Case-insensitive match so .MP3 files are picked up too
const songs = fs
  .readdirSync(songsDir)
  .filter((file) => /\.mp3$/i.test(file))
  .sort();

// Nothing to play, so stop here instead of starting an empty player
if (songs.length === 0) {
  console.error('No mp3 files found in songs/');
  process.exit(1);
}

// Holds the current afplay process so it can be stopped later
let player;

function playSong(index) {
  // Reject decimals/NaN so a bad index doesn't reach the array lookup
  if (!Number.isInteger(index) || !songs[index]) {
    console.log('No song at that number');
    return;
  }

  const songPath = path.join(songsDir, songs[index]);
  // afplay is the built-in macOS command line audio player
  player = spawn('afplay', [songPath]);
  console.log(`Playing: ${songs[index]}`);
}

// Tracks which row the arrow keys are currently pointing at
let cursor = 0;

// Guards against running the terminal restore twice (e.g. exit fires after
// the Ctrl+C handler already cleaned up)
let cleaned = false;

function cleanup() {
  if (cleaned) return;
  cleaned = true;

  // Show the terminal cursor again since ui.js hid it on startup
  process.stdout.write('\x1B[?25h');

  // Only a TTY was put into raw mode in the first place
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  // Leave the shell prompt on its own line instead of at the end of the list
  process.stdout.write('\r\n');
}

// 'exit' is a safety net that catches every way the process ends, including
// a plain process.exit() call elsewhere in this file
process.on('exit', cleanup);

// SIGKILL can't be listened for at all - the OS force-kills the process
// immediately without letting any JS run, so there's no hook to clean up on
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

// Raw mode delivers every keypress immediately instead of a whole line
process.stdin.setRawMode(true);
process.stdin.resume();

process.stdin.on('data', (key) => {
  // Raw mode disables the default Ctrl+C exit, so handle it ourselves first.
  // "q" (0x71) is a second, more discoverable way to quit.
  if (key[0] === 0x03 || key[0] === 0x71) {
    cleanup();
    process.exit(0);
  }

  // Arrow keys arrive as the 3 bytes 0x1b 0x5b <direction>
  if (key[0] === 0x1b && key[1] === 0x5b) {
    if (key[2] === 0x41) {
      // Up: add the length first so (cursor - 1) can't go negative before the modulo
      cursor = (cursor - 1 + songs.length) % songs.length;
    } else if (key[2] === 0x42) {
      // Down: modulo wraps past the last song back to the first
      cursor = (cursor + 1) % songs.length;
    }
  }

  render(songs, cursor);
});

render(songs, cursor);
