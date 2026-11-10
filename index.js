/**
 * BlueHunter entry point.
 *
 * Self-healing dependency check for hosts where you only get a file manager
 * (no terminal). On every start it verifies that:
 *   1. every package in package.json exists in node_modules, and
 *   2. `sharp` can actually load its native binary on THIS machine.
 * If either check fails (e.g. node_modules or package-lock.json were built on
 * Windows and uploaded to a Linux host), it runs `npm install` itself, then
 * starts the bot. When everything is fine this costs a few milliseconds.
 *
 * A broken sharp never stops the bot: sticker conversion is optional and
 * stickerMaker.js already loads sharp lazily.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;

function log(msg) {
  console.log(`[boot] ${msg}`);
}

function missingDeps() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return Object.keys(pkg.dependencies || {}).filter(
      (dep) => !fs.existsSync(path.join(ROOT, 'node_modules', dep))
    );
  } catch {
    return [];
  }
}

function sharpWorks() {
  try {
    require('sharp');
    return true;
  } catch {
    // Drop any half-loaded entries so a retry after install starts clean.
    for (const key of Object.keys(require.cache)) {
      if (/[\\/]node_modules[\\/](sharp|@img)[\\/]/.test(key)) delete require.cache[key];
    }
    return false;
  }
}

function run(cmd) {
  log(`running: ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function ensureDependencies() {
  const missing = missingDeps();
  const sharpOk = missing.includes('sharp') ? false : sharpWorks();

  if (!missing.length && sharpOk) return;

  if (missing.length) log(`missing packages: ${missing.join(', ')}`);
  if (!sharpOk) log('sharp cannot load its native binary on this machine - reinstalling');

  // A lockfile generated on Windows only lists the Windows sharp binary, so
  // npm would keep skipping the Linux one. Remove it so npm resolves fresh.
  const lock = path.join(ROOT, 'package-lock.json');
  if (!sharpOk && fs.existsSync(lock)) {
    try {
      fs.rmSync(lock);
      log('removed platform-specific package-lock.json');
    } catch (err) {
      log(`could not remove package-lock.json: ${err.message}`);
    }
  }

  try {
    run('npm install --include=optional --no-audit --no-fund');
  } catch (err) {
    log(`npm install failed: ${err.message}`);
  }

  if (sharpWorks()) {
    log('sharp OK');
    return;
  }

  // Last resort: force the binary for this exact OS/CPU.
  try {
    const libc = fs.existsSync('/etc/alpine-release') ? ' --libc=musl' : '';
    run(`npm install --os=${process.platform} --cpu=${process.arch}${libc} sharp --no-audit --no-fund`);
  } catch (err) {
    log(`forced sharp install failed: ${err.message}`);
  }

  if (sharpWorks()) log('sharp OK');
  else log('WARNING: sharp still unavailable - stickers will not work, everything else will.');
}

ensureDependencies();

require('./src/bot');
