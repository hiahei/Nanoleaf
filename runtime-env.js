const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function safeRealpath(targetPath) {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return path.resolve(String(targetPath || ''));
  }
}

function isExecutableFile(candidate) {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    if (process.platform !== 'win32') {
      fs.accessSync(candidate, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function macTexLiveBinDirectories() {
  const directories = [];
  for (const root of ['/usr/local/texlive', '/opt/homebrew/opt/texlive']) {
    if (!fs.existsSync(root)) continue;
    const directBin = path.join(root, 'bin');
    if (fs.existsSync(directBin)) directories.push(directBin);
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d{4}/.test(entry.name))
        .map((entry) => entry.name)
        .sort()
        .reverse();
      for (const year of entries) {
        const binRoot = path.join(root, year, 'bin');
        if (!fs.existsSync(binRoot)) continue;
        for (const arch of ['universal-darwin', 'arm64-darwin', 'x86_64-darwin']) {
          const archBin = path.join(binRoot, arch);
          if (fs.existsSync(archBin)) directories.push(archBin);
        }
      }
    } catch {
      // Ignore unreadable system TeX directories.
    }
  }
  return directories;
}

function runtimeSearchDirectories(appRoot = __dirname) {
  const home = os.homedir();
  const candidates = [
    path.join(appRoot, 'tools', 'texbin'),
    path.join(appRoot, 'tools', 'TinyTeX', 'bin', 'universal-darwin'),
    path.join(appRoot, 'tools', 'TinyTeX', 'bin', 'arm64-darwin'),
    path.join(appRoot, 'tools', 'tectonic'),
    path.join(appRoot, 'tools', 'node', 'bin'),
    process.execPath ? path.dirname(process.execPath) : '',
    ...String(process.env.PATH || '').split(path.delimiter),
  ];

  if (process.platform === 'darwin') {
    candidates.push(
      '/Library/TeX/texbin',
      path.join(home, 'Library', 'TinyTeX', 'bin', 'universal-darwin'),
      path.join(home, 'Library', 'TinyTeX', 'bin', 'arm64-darwin'),
      path.join(home, 'Library', 'TinyTeX', 'bin', 'x86_64-darwin'),
      ...macTexLiveBinDirectories(),
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      '/opt/local/bin',
      path.join(home, 'bin'),
      path.join(home, '.local', 'bin'),
      path.join(home, '.cargo', 'bin'),
      '/Applications/MiKTeX Console.app/Contents/bin',
      path.join(home, 'Applications', 'MiKTeX Console.app', 'Contents', 'bin'),
    );
  } else if (process.platform === 'win32') {
    candidates.push(
      path.join(appRoot, 'tools', 'miktex', 'texmfs', 'install', 'miktex', 'bin', 'x64'),
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64') : '',
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'MiKTeX', 'miktex', 'bin', 'x64') : '',
    );
  }

  const seen = new Set();
  const result = [];
  for (const rawEntry of candidates) {
    const entry = String(rawEntry || '').trim();
    if (!entry) continue;
    const normalized = path.resolve(entry);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (fs.existsSync(normalized)) result.push(normalized);
  }
  return result;
}

function buildRuntimePath(appRoot = __dirname, extraDirectories = []) {
  const seen = new Set();
  const ordered = [];
  for (const rawDir of [...extraDirectories, ...runtimeSearchDirectories(appRoot)]) {
    const dir = String(rawDir || '').trim();
    if (!dir) continue;
    if (seen.has(dir)) continue;
    seen.add(dir);
    ordered.push(dir);
  }
  return ordered.join(path.delimiter);
}

let cachedMacProxyEnv = null;

function parseScutilProxyOutput(output) {
  const text = String(output || '');
  const field = (name) => text.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'm'))?.[1]?.trim() || '';
  const result = {};
  if (field('HTTPEnable') === '1') {
    const host = field('HTTPProxy');
    const port = field('HTTPPort');
    if (host && port) result.HTTP_PROXY = `http://${host}:${port}`;
  }
  if (field('HTTPSEnable') === '1') {
    const host = field('HTTPSProxy');
    const port = field('HTTPSPort');
    if (host && port) result.HTTPS_PROXY = `http://${host}:${port}`;
  } else if (result.HTTP_PROXY) {
    result.HTTPS_PROXY = result.HTTP_PROXY;
  }
  if (!result.HTTP_PROXY && !result.HTTPS_PROXY && field('SOCKSEnable') === '1') {
    const host = field('SOCKSProxy');
    const port = field('SOCKSPort');
    if (host && port) result.ALL_PROXY = `socks5h://${host}:${port}`;
  }
  if (Object.keys(result).length > 0) {
    result.NO_PROXY = '127.0.0.1,localhost,::1,*.local';
  }
  return result;
}

function macSystemProxyEnv() {
  if (process.platform !== 'darwin') return {};
  if (cachedMacProxyEnv) return cachedMacProxyEnv;
  try {
    const scutil = spawnSync('/usr/sbin/scutil', ['--proxy'], {
      encoding: 'utf8',
      timeout: 1500,
    });
    cachedMacProxyEnv = scutil.status === 0 ? parseScutilProxyOutput(scutil.stdout) : {};
  } catch {
    cachedMacProxyEnv = {};
  }
  return cachedMacProxyEnv;
}

function buildRuntimeEnv(baseEnv = process.env, overrides = {}, appRoot = __dirname, extraDirectories = []) {
  const overridePath = overrides.PATH || overrides.Path || '';
  const overrideDirs = overridePath ? String(overridePath).split(path.delimiter) : [];
  const hasExplicitProxy = Boolean(
    baseEnv.HTTPS_PROXY || baseEnv.https_proxy
    || baseEnv.HTTP_PROXY || baseEnv.http_proxy
    || baseEnv.ALL_PROXY || baseEnv.all_proxy
    || overrides.HTTPS_PROXY || overrides.HTTP_PROXY || overrides.ALL_PROXY,
  );
  const proxyDefaults = hasExplicitProxy ? {} : macSystemProxyEnv();
  return {
    ...proxyDefaults,
    ...baseEnv,
    ...overrides,
    PATH: buildRuntimePath(appRoot, [...extraDirectories, ...overrideDirs]),
  };
}

function commandPath(command, appRoot = __dirname) {
  const names = process.platform === 'win32' && !command.toLowerCase().endsWith('.exe')
    ? [`${command}.exe`, command]
    : [command];

  for (const directory of runtimeSearchDirectories(appRoot)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (isExecutableFile(candidate)) return candidate;
    }
  }

  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(locator, [command], {
    encoding: 'utf8',
    env: buildRuntimeEnv(process.env, {}, appRoot),
    windowsHide: true,
  });

  if (result.status === 0) {
    const discovered = String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (discovered && isExecutableFile(discovered)) return discovered;
  }

  return null;
}

module.exports = {
  buildRuntimeEnv,
  buildRuntimePath,
  commandPath,
  macSystemProxyEnv,
  parseScutilProxyOutput,
  runtimeSearchDirectories,
  safeRealpath,
};
