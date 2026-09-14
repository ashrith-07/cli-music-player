// Hide the blinking terminal cursor so it doesn't sit on top of the list
process.stdout.write('\x1B[?25l');

// Redraws the whole list in place instead of clearing the screen, so the
// terminal doesn't flicker on every keypress
function render(songs, cursor) {
  const lines = songs.map((song, index) => {
    const text = `${index}: ${song}`;
    const row = index === cursor ? `\x1B[36m> ${text}\x1B[0m` : `  ${text}`;
    // \r\x1B[0K erases the rest of the row before the new text overwrites it
    return `\r\x1B[0K${row}\r\n`;
  });

  // \x1B[H moves the cursor home first, then one write draws the whole frame
  process.stdout.write(`\x1B[H${lines.join('')}`);
}

module.exports = render;
