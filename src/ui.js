// Hide the blinking terminal cursor so it doesn't sit on top of the list
process.stdout.write('\x1B[?25l');

const BAR_WIDTH = 40;
const EQ_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const EQ_BAR_COUNT = 16;

// Persists across renders so the equaliser can freeze in place while paused
// instead of resetting every tick
let eqHeights = new Array(EQ_BAR_COUNT).fill(0);

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function buildProgressBar(elapsed, duration) {
  // Duration isn't known yet (afinfo hasn't answered, or nothing is loaded)
  if (!duration) {
    return `[${' '.repeat(BAR_WIDTH)}] --:-- / --:--`;
  }

  // Clamp first - afinfo's duration is only an estimate and the elapsed
  // counter can overshoot it, so the raw ratio could go negative or over 100
  const percent = Math.min(100, Math.max(0, (elapsed / duration) * 100));
  // Math.round because String.repeat throws on a negative number or a fraction
  const filled = Math.round((percent / 100) * BAR_WIDTH);
  const color = percent < 50 ? '\x1B[32m' : percent <= 80 ? '\x1B[33m' : '\x1B[31m';
  const bar = `${color}${'█'.repeat(filled)}\x1B[0m${' '.repeat(BAR_WIDTH - filled)}`;

  return `[${bar}] ${formatTime(elapsed)} / ${formatTime(duration)}`;
}

function buildEqualiser(isPlaying, isPaused) {
  if (!isPlaying) {
    // Nothing loaded - flat line at the lowest level
    eqHeights = eqHeights.map(() => 0);
  } else if (!isPaused) {
    // A fresh random height per bar, but only while actually playing
    eqHeights = eqHeights.map(() => Math.floor(Math.random() * EQ_CHARS.length));
  }
  // Paused: leave eqHeights as they are so the bars stay frozen in place

  const bars = eqHeights.map((height) => EQ_CHARS[height]).join('');
  return `\x1B[36m${bars}\x1B[0m`;
}

// Redraws the whole screen in place instead of clearing it, so the terminal
// doesn't flicker on every keypress or timer tick
function render(songs, cursor, playingIndex, isPaused, hasVlc, repeatMode, shuffle, elapsed, duration, seekNotice) {
  const backend = hasVlc ? 'VLC' : 'afplay';
  const statusLine = `Backend: ${backend} | Repeat: ${repeatMode} | Shuffle: ${shuffle ? 'on' : 'off'}`;
  const progressLine = buildProgressBar(elapsed, duration);
  const eqLine = buildEqualiser(playingIndex !== null, isPaused);
  const noticeLine = seekNotice ? 'Seeking needs VLC' : '';

  const songLines = songs.map((song, index) => {
    let text = `${index}: ${song}`;
    if (index === playingIndex) {
      text += isPaused ? ' [paused]' : ' [playing]';
    }
    const row = index === cursor ? `\x1B[36m> ${text}\x1B[0m` : `  ${text}`;
    // \r\x1B[0K erases the rest of the row before the new text overwrites it
    return `\r\x1B[0K${row}\r\n`;
  });

  const lines = [
    `\r\x1B[0K${statusLine}\r\n`,
    `\r\x1B[0K${progressLine}\r\n`,
    `\r\x1B[0K${eqLine}\r\n`,
    `\r\x1B[0K${noticeLine}\r\n`,
    ...songLines,
  ];

  // \x1B[H moves the cursor home first, then one write draws the whole frame
  process.stdout.write(`\x1B[H${lines.join('')}`);
}

module.exports = render;
