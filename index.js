const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const render = require('./src/ui');
const { play, pause, resume, stop, hasVlc } = require('./src/player');

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

// Tracks which row the arrow keys are currently pointing at
let cursor = 0;

// Playback state is separate from cursor, since browsing the list shouldn't
// stop whatever is currently playing
let player = null;
let playingIndex = null;
let isPaused = false;

// 'off' | 'one' | 'all', and shuffle is independent of repeat
let repeatMode = 'off';
let shuffle = false;

// Seconds into the current song, and its total length once afinfo answers
let elapsed = 0;
let duration = null;

// A short-lived message shown after a key that only VLC can act on
let seekNotice = false;

// Draws the current state - one place so every call site stays in sync as
// that state keeps growing
function draw() {
  render(songs, cursor, playingIndex, isPaused, hasVlc, repeatMode, shuffle, elapsed, duration, seekNotice);
}

// Runs `afinfo` once per song and resolves its estimated duration in seconds
function getDuration(songPath) {
  return new Promise((resolve) => {
    const afinfo = spawn('afinfo', [songPath]);
    let output = '';

    // afinfo's output can arrive split across several chunks, so only the
    // full, joined text is safe to search
    afinfo.stdout.on('data', (chunk) => {
      output += chunk;
    });

    // Every path must resolve, or a failed/odd afinfo run leaves the promise
    // (and whoever awaits it) hanging forever
    afinfo.on('error', () => resolve(null));

    afinfo.on('close', () => {
      const match = output.match(/estimated duration: ([\d.]+) sec/);
      resolve(match ? parseFloat(match[1]) : null);
    });
  });
}

// Holds the one live elapsed-time interval so starting a new song can never
// leave an old one running alongside it
let elapsedTimer = null;

function startElapsedTimer() {
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    if (!isPaused) {
      elapsed += 0.25;
    }
    draw();
  }, 250);
}

function stopElapsedTimer() {
  clearInterval(elapsedTimer);
  elapsedTimer = null;
}

function stopPlayback() {
  if (player) {
    // VLC's "quit" command exits gracefully with no signal, same as a song
    // ending on its own, so this flag is how the close handler below tells
    // "we stopped it" apart from "it finished naturally" for that backend
    player.stoppedByUser = true;
    stop(player);
  }
  player = null;
  playingIndex = null;
  isPaused = false;
  elapsed = 0;
  duration = null;
  stopElapsedTimer();
}

function togglePause() {
  // Nothing is playing yet, so there's nothing to pause/resume
  if (!player) return;

  if (isPaused) {
    resume(player);
  } else {
    pause(player);
  }
  isPaused = !isPaused;
}

// Decides what plays next when a song ends naturally
function getNextIndex(current) {
  if (repeatMode === 'one') return current;

  if (shuffle) {
    // Only one song exists, so there's no "different" index to pick
    if (songs.length === 1) return current;

    let next;
    do {
      next = Math.floor(Math.random() * songs.length);
    } while (next === current);
    return next;
  }

  if (repeatMode === 'all') {
    return (current + 1) % songs.length;
  }

  // Nothing queued next, so playback just stops
  return null;
}

function playIndex(index) {
  stopPlayback();

  const songPath = path.join(songsDir, songs[index]);
  const newPlayer = play(songPath);
  player = newPlayer;
  playingIndex = index;
  cursor = index;
  isPaused = false;
  startElapsedTimer();

  getDuration(songPath).then((result) => {
    // Ignore a stale answer if the user already moved on to another song
    // while afinfo was still running
    if (player !== newPlayer) return;
    duration = result;
    draw();
  });

  newPlayer.on('error', () => {
    player = null;
    playingIndex = null;
    isPaused = false;
    stopElapsedTimer();
    draw();
  });

  newPlayer.on('close', (code, signal) => {
    // A real signal (afplay) or our own flag (VLC) means we stopped this on
    // purpose - e.g. pressing 'n' - so don't also auto-advance, or skipping
    // a track would skip two
    if (signal !== null || newPlayer.stoppedByUser) return;

    const nextIndex = getNextIndex(index);
    if (nextIndex === null) {
      player = null;
      playingIndex = null;
      isPaused = false;
      stopElapsedTimer();
    } else {
      playIndex(nextIndex);
    }
    draw();
  });
}

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

  // Cleared by default; the left/right branch below re-sets it when it
  // actually applies, so it disappears again on the next keypress
  seekNotice = false;

  // Arrow keys arrive as the 3 bytes 0x1b 0x5b <direction>
  if (key[0] === 0x1b && key[1] === 0x5b) {
    if (key[2] === 0x41) {
      // Up: add the length first so (cursor - 1) can't go negative before the modulo
      cursor = (cursor - 1 + songs.length) % songs.length;
    } else if (key[2] === 0x42) {
      // Down: modulo wraps past the last song back to the first
      cursor = (cursor + 1) % songs.length;
    } else if (key[2] === 0x44 || key[2] === 0x43) {
      // Left/Right: seek 10s back/forward - only VLC's rc interface can do this
      if (!hasVlc) {
        seekNotice = true;
      } else if (player && duration !== null) {
        const step = key[2] === 0x43 ? 10 : -10;
        // Clamp to the song's bounds - our elapsed counter can drift past
        // afinfo's estimate, and seeking below 0 makes no sense
        const target = Math.min(duration, Math.max(0, elapsed + step));
        player.stdin.write(`seek ${Math.round(target)}\n`);
        elapsed = target;
      }
    }
  }

  // Enter always starts fresh: play the song currently under the cursor
  if (key[0] === 0x0d) {
    playIndex(cursor);
  }

  // Space toggles pause/resume on whatever is currently playing
  if (key[0] === 0x20) {
    togglePause();
  }

  // 's' stops playback outright
  if (key[0] === 0x73) {
    stopPlayback();
  }

  // 'n' next / 'b' previous - navigate from whatever is playing, or from the
  // cursor if nothing is
  if (key[0] === 0x6e || key[0] === 0x62) {
    const from = playingIndex !== null ? playingIndex : cursor;
    const step = key[0] === 0x6e ? 1 : -1;
    // Add songs.length so going back from 0 can't go negative before the modulo
    playIndex((from + step + songs.length) % songs.length);
  }

  // 'r' cycles repeat mode: off -> one -> all -> off
  if (key[0] === 0x72) {
    if (repeatMode === 'off') {
      repeatMode = 'one';
    } else if (repeatMode === 'one') {
      repeatMode = 'all';
    } else {
      repeatMode = 'off';
    }
  }

  // 'h' toggles shuffle on/off
  if (key[0] === 0x68) {
    shuffle = !shuffle;
  }

  draw();
});

draw();
