const fs = require('fs');
const { spawn } = require('child_process');

const VLC_PATH = '/Applications/VLC.app/Contents/MacOS/VLC';

// Checked once at startup to decide which backend the rest of this module uses
const hasVlc = fs.existsSync(VLC_PATH);

function play(songPath) {
  if (hasVlc) {
    // --intf rc opens a text-command interface on stdin so pause/stop can
    // talk to VLC; --play-and-exit quits VLC when the song ends so our
    // 'exit'/'error' handlers fire; stdio keeps stdin open for commands
    // while throwing away VLC's constant chatter on stdout/stderr
    return spawn(VLC_PATH, ['--intf', 'rc', '--play-and-exit', songPath], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
  }

  return spawn('afplay', [songPath]);
}

function pause(player) {
  if (hasVlc) {
    // rc's "pause" command toggles - only safe here because we only ever
    // call pause() while we know VLC is playing
    player.stdin.write('pause\n');
    return;
  }

  // Freezing the process holds it exactly where it is - see resume() for
  // why this beats killing and respawning
  player.kill('SIGSTOP');
}

function resume(player) {
  if (hasVlc) {
    // "play" (not the "pause" toggle) explicitly resumes regardless of
    // VLC's current state, so our isPaused tracking can never desync it
    player.stdin.write('play\n');
    return;
  }

  // SIGCONT unfreezes the same afplay process, so it keeps reading the file
  // from the byte it stopped at. Killing and respawning would instead start
  // a brand new afplay process reading the file from the beginning.
  player.kill('SIGCONT');
}

function stop(player) {
  if (hasVlc) {
    player.stdin.write('quit\n');
    return;
  }

  // A SIGSTOP'd process is frozen and can't react to anything, including the
  // SIGTERM below, so it has to be resumed before it can be told to quit.
  // Never SIGKILL: it can't be caught, so afplay never gets to release the
  // sound device before dying.
  player.kill('SIGCONT');
  player.kill('SIGTERM');
}

module.exports = { play, pause, resume, stop, hasVlc };
