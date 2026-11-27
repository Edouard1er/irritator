import { execFile, fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// The existing Next CLI owns its development worker. Ask it to run its regular shutdown.
if (process.env.GUIERS_CHILD_SHUTDOWN === '1') {
  process.once('disconnect', () => process.emit('SIGTERM', 'SIGTERM'));
} else {
  await supervise();
}

async function supervise() {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const web = join(repo, 'web');
  const frontend = join(web, 'apps/frontend');
  const runtime = join(repo, 'local-sig-guiers', 'runtime');
  const lock = join(runtime, 'active.pid');
  const stopRequest = join(runtime, 'stop.pid');
  const children = [];
  let stopping = false;
  try {
    await writeFile(lock, String(process.pid), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lock, 'utf8'));
    try { process.kill(pid, 0); }
    catch (cause) {
      if (cause.code !== 'ESRCH') throw cause;
      await unlink(lock);
      await writeFile(lock, String(process.pid), { flag: 'wx' });
    }
    if (Number(await readFile(lock, 'utf8')) !== process.pid) throw new Error(`Session Guiers déjà active (PID ${pid}).`);
  }

  async function stop(failed = false) {
    if (stopping) return;
    stopping = true;
    clearInterval(watcher);
    await Promise.all(children.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
      const exited = once(child, 'exit');
      if (child.connected) child.disconnect();
      if (await Promise.race([exited.then(() => false), delay(5000, true, { ref: false })])) {
        child.kill();
        await exited;
      }
    }));
    await unlink(lock).catch(() => {});
    process.exitCode = failed ? 1 : 0;
  }

  const watcher = setInterval(async () => {
    if (await readFile(stopRequest, 'utf8').catch(() => '') === String(process.pid)) {
      await unlink(stopRequest).catch(() => {});
      await stop();
    }
  }, 500);
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());

  function start(file, args, cwd) {
    const child = fork(file, args, { cwd, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      execArgv: ['--import', new URL(import.meta.url).href],
      env: { ...process.env, GUIERS_CHILD_SHUTDOWN: '1' } });
    children.push(child);
    child.once('error', error => { console.error(error); void stop(true); });
    child.once('exit', (code, signal) => {
      if (!stopping) { console.error(`${file} s’est arrêté (${code ?? signal}).`); void stop(true); }
    });
  }

  async function ready(url, headers) {
    for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
      try {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
        if (response.ok) return response;
      } catch { /* Retry while the servers start. */ }
      await delay(500);
    }
    if (!stopping) throw new Error(`Service non disponible à ${url}`);
  }

  try {
    start(resolve(web, 'build-guiers-api/apps/api/src/server.js'), [], web);
    const health = await ready('http://127.0.0.1:3001/api/v1/health');
    if (!health || !(await health.json()).runner?.available) throw new Error('Dialogue avec le runner natif indisponible.');
    if (process.env.GUIERS_LOCAL_PROFILE) {
      const reference = await fetch('http://127.0.0.1:3001/local/guiers/reference', {
        headers: { Origin: 'http://localhost:3000' }, signal: AbortSignal.timeout(15000),
      });
      if (!reference.ok) console.warn('Profil SIG local refusé par l’API. HydroLAKES reste disponible.');
      await reference.body?.cancel();
    }
    if (stopping) return;
    start(join(frontend, 'node_modules/next/dist/bin/next'), ['dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3000'], frontend);
    const page = await ready('http://localhost:3000');
    if (!page) return;
    await page.body?.cancel();
    console.log('Irritator prêt sur http://localhost:3000 — API et runner sur 127.0.0.1:3001.');
    if (!process.argv.includes('--no-browser')) {
      execFile('rundll32.exe', ['url.dll,FileProtocolHandler', 'http://localhost:3000'], error => {
        if (error) console.warn('Ouvrez http://localhost:3000 dans votre navigateur.');
      });
    }
  } catch (error) {
    console.error(error);
    await stop(true);
  }
}
