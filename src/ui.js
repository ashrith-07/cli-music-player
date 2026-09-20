// Hide the blinking terminal cursor so it doesn't sit on top of the list
process.stdout.write('\x1B[?25l');

const BAR_WIDTH = 40;
const EQ_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const EQ_BAR_COUNT = 16;

// Inner width of the header box, between its two border characters
const HEADER_WIDTH = 44;

const HELP_TEXT =
  '↑/↓ move   enter play   space pause   s stop   n next   b previous   r repeat   h shuffle   ←/→ seek   q quit';

// Persists across renders so the equaliser can freeze in place while paused
// instead of resetting every tick
let eqHeights = new Array(EQ_BAR_COUNT).fill(0);

// Formats a number of seconds as "m:ss"
function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// Pads or truncates text to an exact width, so box borders always line up
function fitLine(text, width) {
  if (text.length > width) return `${text.slice(0, width - 1)}…`;
  return text.padEnd(width, ' ');
}

// Builds the bordered title box showing the app name and current status
function buildHeader(playingIndex, songs, playbackError) {
  const border = '─'.repeat(HEADER_WIDTH + 2);

  let status;
  if (playbackError) {
    status = playbackError;
  } else if (playingIndex !== null) {
    status = `Now playing: ${songs[playingIndex]}`;
  } else {
    status = 'Nothing playing';
  }

  return [
    `┌${border}┐`,
    `│ ${fitLine('CLI Music Player', HEADER_WIDTH)} │`,
    `│ ${fitLine(status, HEADER_WIDTH)} │`,
    `└${border}┘`,
  ];
}

// Builds the colour-coded "[####    ] 1:23 / 4:56" progress bar line
function buildProgressBar(elapsed, duration, durationUnavailable) {
  if (durationUnavailable) {
    return 'Duration unavailable (afinfo not found)';
  }

  // Duration isn't known yet (afinfo hasn't answered, or nothing is loaded)
  if (!duration) {
    return `[${' '.repeat(BAR_WIDTH)}] --:-- / --:--`;
  }

  // Clamp first - afinfo's duration is only an estimate and the elapsed
  // counter can overshoot it, so the raw ratio could go negative or over 100
  const percent = Math.min(100, Math.max(0, (elapsed / duration) * 100));
  // Math.round because String.repeat throws on a negative number or a fraction
  const filled = Math.round((percent / 100) * BAR_WIDTH);

  let color;
  if (percent < 50) {
    color = '\x1B[32m'; // green
  } else if (percent <= 80) {
    color = '\x1B[33m'; // yellow
  } else {
    color = '\x1B[31m'; // red
  }

  const bar = `${color}${'█'.repeat(filled)}\x1B[0m${' '.repeat(BAR_WIDTH - filled)}`;

  return `[${bar}] ${formatTime(elapsed)} / ${formatTime(duration)}`;
}

// Builds the animated equaliser line, one random bar height per render
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
function render(state) {
  const {
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
  } = state;

  const backend = hasVlc ? 'VLC' : 'afplay';
  const statusLine = `Backend: ${backend} | Repeat: ${repeatMode} | Shuffle: ${shuffle ? 'on' : 'off'}`;
  const progressLine = buildProgressBar(elapsed, duration, durationUnavailable);
  const eqLine = buildEqualiser(playingIndex !== null, isPaused);
  const noticeLine = showSeekNotice ? 'Seeking needs VLC' : '';

  const songRows = songs.map((song, index) => {
    let text = `${index}: ${song}`;
    if (index === playingIndex) {
      text += isPaused ? ' [paused]' : ' [playing]';
    }
    return index === cursor ? `\x1B[36m> ${text}\x1B[0m` : `  ${text}`;
  });

  const rows = [
    ...buildHeader(playingIndex, songs, playbackError),
    statusLine,
    progressLine,
    eqLine,
    noticeLine,
    ...songRows,
    `\x1B[2m${HELP_TEXT}\x1B[0m`,
  ];

  // \r\x1B[0K erases each row before the new text lands on it. The rows are
  // joined with \r\n instead of each ending in one, because a newline after
  // the *last* row scrolls the terminal once the frame reaches the bottom of
  // the window - and after a scroll \x1B[H no longer lines up with the frame
  // already on screen, which strands copies of old rows above the new one.
  const frame = rows.map((row) => `\r\x1B[0K${row}`).join('\r\n');

  // \x1B[H moves the cursor home first, then one write draws the whole frame
  process.stdout.write(`\x1B[H${frame}`);
}

module.exports = render;
