const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const {
  buildRuntimeEnv,
  commandPath,
  parseScutilProxyOutput,
  runtimeSearchDirectories,
} = require('../runtime-env');
const { synctexEditFallback, synctexViewFallback } = require('../synctex-fallback');

test('runtime environment includes active Node directory and macOS search paths', () => {
  const dirs = runtimeSearchDirectories(path.join(__dirname, '..'));
  assert.ok(dirs.includes(path.dirname(process.execPath)));

  const env = buildRuntimeEnv({ TEST_VAR: 'ok' }, {}, path.join(__dirname, '..'));
  assert.equal(env.TEST_VAR, 'ok');
  assert.ok(env.PATH.includes(path.dirname(process.execPath)));
  assert.equal(commandPath('node', path.join(__dirname, '..')), process.execPath);

  const parsedProxy = parseScutilProxyOutput([
    '<dictionary> {',
    '  HTTPEnable : 1',
    '  HTTPPort : 7897',
    '  HTTPProxy : 127.0.0.1',
    '  HTTPSEnable : 1',
    '  HTTPSPort : 7897',
    '  HTTPSProxy : 127.0.0.1',
    '}',
  ].join('\n'));
  assert.equal(parsedProxy.HTTP_PROXY, 'http://127.0.0.1:7897');
  assert.equal(parsedProxy.HTTPS_PROXY, 'http://127.0.0.1:7897');
  assert.match(parsedProxy.NO_PROXY, /127\.0\.0\.1/);
});

test('synctex fallback parses gzipped synctex data for forward and reverse lookup', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localtex-synctex-'));
  try {
    const mainTex = path.join(tempDir, 'main.tex');
    fs.writeFileSync(mainTex, '\\documentclass{article}\n\\begin{document}\nHello Mac\n\\end{document}\n', 'utf8');

    const synctexRaw = [
      'SyncTeX Version:1',
      `Input:1:${fs.realpathSync.native(mainTex)}`,
      'Output:pdf',
      'Magnification:1000',
      'Unit:1',
      'X Offset:0',
      'Y Offset:0',
      'Content:',
      '{1',
      '[1,4:4736286,43718656:30146560,36044800,0',
      '(1,3:8779427,9083781:5242880,655360,0',
      'x1,3:9500000,9083781',
      ')',
      ']',
      '}',
      'Postamble:',
    ].join('\n');

    const synctexGzPath = path.join(tempDir, 'main.synctex.gz');
    fs.writeFileSync(synctexGzPath, zlib.gzipSync(Buffer.from(synctexRaw, 'utf8')));

    const forward = synctexViewFallback(synctexGzPath, {
      sourcePath: mainTex,
      line: 3,
      mainDirectory: tempDir,
    });
    assert.equal(forward.length, 1);
    assert.equal(forward[0].page, 1);
    assert.ok(forward[0].x > 100 && forward[0].x < 200);
    assert.ok(forward[0].y > 100 && forward[0].y < 200);

    const reverse = synctexEditFallback(synctexGzPath, {
      page: 1,
      x: forward[0].x,
      y: forward[0].y,
      mainDirectory: tempDir,
    });
    assert.ok(reverse);
    assert.equal(reverse.line, 3);
    assert.equal(fs.realpathSync.native(reverse.input), fs.realpathSync.native(mainTex));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('macOS launcher scripts pass zsh syntax check and Info.plist lint', { skip: process.platform !== 'darwin' }, () => {
  const root = path.join(__dirname, '..');
  for (const script of [
    'launch-localtex.sh',
    'stop-localtex.sh',
    'start-local.command',
    'LocalTeX.app/Contents/MacOS/LocalTeX',
  ]) {
    const check = spawnSync('/bin/zsh', ['-n', path.join(root, script)], { encoding: 'utf8' });
    assert.equal(check.status, 0, `${script} failed zsh -n: ${check.stderr}`);
  }

  const plistCheck = spawnSync('/usr/bin/plutil', ['-lint', path.join(root, 'LocalTeX.app/Contents/Info.plist')], {
    encoding: 'utf8',
  });
  assert.equal(plistCheck.status, 0, plistCheck.stderr || plistCheck.stdout);
});
