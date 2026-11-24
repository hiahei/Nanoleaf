const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { safeRealpath } = require('./runtime-env');

const SP_PER_BP = 65781.76;

function readSynctexText(synctexPath) {
  const raw = fs.readFileSync(synctexPath);
  if (synctexPath.toLowerCase().endsWith('.gz') || (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b)) {
    return zlib.gunzipSync(raw).toString('utf8');
  }
  return raw.toString('utf8');
}

function parseSynctexData(synctexPath, mainDirectory) {
  const content = readSynctexText(synctexPath);
  const inputs = new Map();
  const nodes = [];
  let magnification = 1000;
  let unit = 1;
  let xOffset = 0;
  let yOffset = 0;
  let inContent = false;
  let currentPage = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    if (!inContent) {
      if (rawLine === 'Content:') {
        inContent = true;
        continue;
      }
      if (rawLine.startsWith('Input:')) {
        const rest = rawLine.slice('Input:'.length);
        const colon = rest.indexOf(':');
        if (colon > 0) {
          const tag = Number(rest.slice(0, colon));
          const rawInputPath = rest.slice(colon + 1).trim();
          const resolved = path.isAbsolute(rawInputPath)
            ? path.resolve(rawInputPath)
            : path.resolve(mainDirectory, rawInputPath);
          inputs.set(tag, {
            raw: rawInputPath,
            resolved,
            real: safeRealpath(resolved),
          });
        }
        continue;
      }
      const magMatch = rawLine.match(/^Magnification:(\d+)/);
      if (magMatch) {
        magnification = Number(magMatch[1]) || 1000;
        continue;
      }
      const unitMatch = rawLine.match(/^Unit:(\d+)/);
      if (unitMatch) {
        unit = Number(unitMatch[1]) || 1;
        continue;
      }
      const xOffMatch = rawLine.match(/^X Offset:(-?\d+)/);
      if (xOffMatch) {
        xOffset = Number(xOffMatch[1]) || 0;
        continue;
      }
      const yOffMatch = rawLine.match(/^Y Offset:(-?\d+)/);
      if (yOffMatch) {
        yOffset = Number(yOffMatch[1]) || 0;
        continue;
      }
      continue;
    }

    if (!rawLine) continue;
    const first = rawLine[0];
    if (first === '{') {
      currentPage = Number(rawLine.slice(1)) || 0;
      continue;
    }
    if (first === '}') {
      currentPage = 0;
      continue;
    }
    if (!currentPage) continue;
    if (!'[(vhxkg$'.includes(first)) continue;

    const match = rawLine.slice(1).match(/^(\d+),(\d+)(?:,(-?\d+))?:(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/);
    if (!match) continue;

    const scale = (unit * (magnification / 1000)) / SP_PER_BP;
    const tag = Number(match[1]);
    const line = Number(match[2]);
    if (!tag || line < 1) continue;
    const column = match[3] !== undefined ? Number(match[3]) : -1;
    const x = (Number(match[4]) + xOffset) * scale;
    const y = (Number(match[5]) + yOffset) * scale;
    const width = match[6] !== undefined ? Math.abs(Number(match[6]) * scale) : 0;
    const height = match[7] !== undefined ? Math.abs(Number(match[7]) * scale) : 0;
    const depth = match[8] !== undefined ? Math.abs(Number(match[8]) * scale) : 0;

    nodes.push({
      kind: first,
      page: currentPage,
      tag,
      line,
      column,
      x,
      y,
      width,
      height,
      depth,
    });
  }

  return { inputs, nodes };
}

function matchingInputTags(inputs, sourcePath) {
  const targetResolved = path.resolve(sourcePath);
  const targetReal = safeRealpath(sourcePath);
  const caseFold = process.platform === 'darwin' || process.platform === 'win32';
  const normalize = (value) => (caseFold ? value.toLowerCase() : value);

  const tags = new Set();
  for (const [tag, info] of inputs.entries()) {
    if (
      normalize(info.resolved) === normalize(targetResolved)
      || normalize(info.real) === normalize(targetReal)
    ) {
      tags.add(tag);
    }
  }
  return tags;
}

function kindPriority(kind) {
  if (kind === 'x' || kind === '$') return 0;
  if (kind === 'h' || kind === 'g' || kind === 'k') return 1;
  if (kind === '(') return 2;
  return 3;
}

function synctexViewFallback(synctexPath, { sourcePath, line, mainDirectory }) {
  const { inputs, nodes } = parseSynctexData(synctexPath, mainDirectory);
  const tags = matchingInputTags(inputs, sourcePath);
  if (!tags.size) return [];

  const exact = nodes.filter((node) => tags.has(node.tag) && node.line === line);
  let candidates = exact;
  if (!candidates.length) {
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const node of nodes) {
      if (!tags.has(node.tag)) continue;
      const distance = Math.abs(node.line - line);
      if (distance < nearestDistance && distance <= 8) nearestDistance = distance;
    }
    if (Number.isFinite(nearestDistance)) {
      candidates = nodes.filter((node) => tags.has(node.tag) && Math.abs(node.line - line) === nearestDistance);
    }
  }
  if (!candidates.length) return [];

  candidates.sort((left, right) => kindPriority(left.kind) - kindPriority(right.kind));

  const byPage = new Map();
  for (const node of candidates) {
    if (!byPage.has(node.page)) {
      byPage.set(node.page, {
        page: node.page,
        x: node.x,
        y: node.y,
        h: node.x,
        v: node.y,
        width: node.width,
        height: node.height + node.depth,
      });
    }
  }
  return [...byPage.values()];
}

function synctexEditFallback(synctexPath, { page, x, y, mainDirectory }) {
  const { inputs, nodes } = parseSynctexData(synctexPath, mainDirectory);
  const pageNodes = nodes.filter((node) => node.page === page && inputs.has(node.tag));
  if (!pageNodes.length) return null;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const node of pageNodes) {
    const minX = node.x;
    const maxX = node.x + Math.max(node.width, 6);
    const minY = node.y - Math.max(node.height, 12);
    const maxY = node.y + Math.max(node.depth, 4);

    const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
    const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
    // Vertical line proximity matters much more than horizontal offset on the same line.
    const distanceScore = Math.hypot(dx * 0.35, dy * 2.5) + kindPriority(node.kind) * 4;
    if (distanceScore < bestScore) {
      bestScore = distanceScore;
      best = node;
    }
  }

  if (!best) return null;
  const inputInfo = inputs.get(best.tag);
  return {
    input: inputInfo.real || inputInfo.resolved,
    line: best.line,
    column: best.column,
  };
}

module.exports = {
  synctexEditFallback,
  synctexViewFallback,
};
