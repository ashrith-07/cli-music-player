const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const render = require('./src/ui');
const { play, pause, resume, stop, hasVlc } = require('./src/player');

console.log('Player is starting...');

// Guards against running the terminal restore twice (e.g. exit fires after
// the Ctrl+C handler already cleaned up)
let cleaned = false;

// Restores the terminal to normal (cursor visible, raw mode off)
function cleanup() {
  if (cleaned) return;
  cleaned = true;

  // Show the terminal cursor again since ui.js hid it as soon as it loaded
  process.stdout.write('\x1B[?25h');

  // Only a TTY was put into raw mode in the first place
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  // Leave the shell prompt on its own line instead of at the end of the list
  process.stdout.write('\r\n');
}

// Stops whatever is playing and restores the terminal before leaving for
// good. stopPlayback() and player are defined further down, but that's fine:
// this function only runs later, once a quit key or signal actually arrives,
// by which point the whole file has already finished loading.
function quit() {
  stopPlayback();
  cleanup();
  process.exit(0);
}

// Registered this early so every exit below - including the songs/ guards
// that follow - restores the terminal cursor instead of leaving it hidden
process.on('exit', cleanup);

// SIGKILL can't be listened for at all - the OS force-kills the process
// immediately without letting any JS run, so there's no hook to clean up on
process.on('SIGINT', quit);
process.on('SIGTERM', quit);

// Songs live next to index.js so the player works from any cwd
const songsDir = path.join(__dirname, 'songs');

// readdirSync would throw a raw stack trace if the folder is simply missing
// (e.g. a fresh clone before songs/ is created), so check for it first
if (!fs.existsSync(songsDir)) {
  console.error('songs/ folder not found - create it and add some .mp3 files');
  process.exit(1);
}

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

// Shows a short message after a key that only VLC can act on
let showSeekNotice = false;

// Set when playback or a duration lookup fails, so the UI can say so instead
// of just going quiet
let playbackError = null;
let durationUnavailable = false;

// Draws the current state - one place so every call site stays in sync as
// that state keeps growing
function draw() {
  render({
    songs,
    cursor,
    playingIndex,
    isPaused,
    hasVlc,
    repeatMode,
    shuffle,
    elapsed,
    duration,
    showSeekNotice,
    playbackError,
    durationUnavailable,
  });
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
    // (and whoever awaits it) hanging forever. afinfo missing (e.g. not on
    // PATH) lands here too, so the caller can tell "not found" apart from
    // "found, but no duration in the output".
    afinfo.on('error', () => resolve({ duration: null, error: true }));

    afinfo.on('close', () => {
      const match = output.match(/estimated duration: ([\d.]+) sec/);
      resolve({ duration: match ? parseFloat(match[1]) : null, error: false });
    });
  });
}

// Holds the one live elapsed-time interval so starting a new song can never
// leave an old one running alongside it
let elapsedTimer = null;

// Starts ticking elapsed time for the song that just started playing
function startElapsedTimer() {
  // Clear any previous song's timer first - without this, every new song
  // adds another interval running in parallel and elapsed speeds up
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    if (!isPaused) {
      elapsed += 0.25;
    }
    draw();
  }, 250);
}

// Stops the elapsed-time interval, e.g. once playback stops entirely
function stopElapsedTimer() {
  clearInterval(elapsedTimer);
  elapsedTimer = null;
}

// Clears playback state back to idle (nothing loaded or playing)
function resetPlaybackState() {
  player = null;
  playingIndex = null;
  isPaused = false;
  stopElapsedTimer();
}

// Stops whatever is currently playing, if anything
function stopPlayback() {
  if (player) {
    // VLC's "quit" command exits gracefully with no signal, same as a song
    // ending on its own, so this flag is how the close handler below tells
    // "we stopped it" apart from "it finished naturally" for that backend
    player.stoppedByUser = true;
    stop(player);
  }
  resetPlaybackState();
  elapsed = 0;
  duration = null;
  playbackError = null;
}

// Pauses if currently playing, resumes if currently paused
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

// Starts playing the song at the given index, replacing whatever was playing
function playIndex(index) {
  stopPlayback();

  const songPath = path.join(songsDir, songs[index]);
  const newPlayer = play(songPath);
  player = newPlayer;
  playingIndex = index;
  cursor = index;
  isPaused = false;
  startElapsedTimer();

  getDuration(songPath).then((durationResult) => {
    // Ignore a stale answer if the user already moved on to another song
    // while afinfo was still running
    if (player !== newPlayer) return;
    duration = durationResult.duration;
    durationUnavailable = durationResult.error;
    draw();
  });

  newPlayer.on('error', () => {
    resetPlaybackState();
    // e.g. neither VLC nor the afplay fallback could be spawned at all
    playbackError = 'Playback failed - no audio backend available';
    draw();
  });

  newPlayer.on('close', (code, signal) => {
    // A real signal (afplay) or our own flag (VLC) means we stopped this on
    // purpose - e.g. pressing 'n' - so don't also auto-advance, or skipping
    // a track would skip two
    if (signal !== null || newPlayer.stoppedByUser) return;

    const nextIndex = getNextIndex(index);
    if (nextIndex === null) {
      resetPlaybackState();
    } else {
      playIndex(nextIndex);
    }
    draw();
  });
}

// Raw mode delivers every keypress immediately instead of a whole line
process.stdin.setRawMode(true);
process.stdin.resume();

// The box border and bar widths are fixed, so a resize doesn't reflow them -
// but the terminal's own redraw can leave stale text behind, so just redraw
process.stdout.on('resize', () => draw());

process.stdin.on('data', (key) => {
  // Raw mode disables the default Ctrl+C exit, so handle it ourselves first.
  // "q" (0x71) is a second, more discoverable way to quit.
  if (key[0] === 0x03 || key[0] === 0x71) {
    quit();
  }

  // Cleared by default; the left/right branch below re-sets it when it
  // actually applies, so it disappears again on the next keypress
  showSeekNotice = false;

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
        showSeekNotice = true;
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

// Wipe whatever the terminal was showing before (shell output, an update log)
// exactly once, so it doesn't sit around the UI. Only here, never per frame -
// clearing on every redraw is what caused the flicker.
process.stdout.write('\x1B[2J');

draw();
