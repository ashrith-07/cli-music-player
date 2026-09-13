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

songs.forEach((song, index) => {
  console.log(`${index}: ${song}`);
});

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

// Listen for the user typing a song number and pressing Enter
process.stdin.on('data', (data) => {
  const index = Number(data.toString().trim());
  playSong(index);
});
