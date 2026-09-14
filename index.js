const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

// Redraws the whole list so only one highlighted row is ever shown
function render() {
  console.clear();
  songs.forEach((song, index) => {
    const prefix = index === cursor ? '> ' : '  ';
    console.log(`${prefix}${index}: ${song}`);
  });
}

// Raw mode delivers every keypress immediately instead of a whole line
process.stdin.setRawMode(true);
process.stdin.resume();

process.stdin.on('data', (key) => {
  // Raw mode disables the default Ctrl+C exit, so handle it ourselves first
  if (key[0] === 0x03) {
    process.stdin.setRawMode(false);
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

  render();
});

render();
