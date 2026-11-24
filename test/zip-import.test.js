const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const {
  extractZipBufferToDirectory,
  importZipProjectToWorkspace,
} = require('../zip-import');

function buildZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const rawData = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(String(entry.data || ''), 'utf8');
    const isDirectory = entry.name.endsWith('/');
    const method = isDirectory ? 0 : (entry.method ?? 8);
    const compressed = method === 8 ? zlib.deflateRawSync(rawData) : rawData;
    const flags = 0x0800; // UTF-8

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    // Deliberately leave 0 in local header when streamingFlag is set to verify central-dir reading.
    localHeader.writeUInt32LE(entry.streaming ? 0 : compressed.length, 18);
    localHeader.writeUInt32LE(entry.streaming ? 0 : rawData.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags | (entry.streaming ? 0x0008 : 0), 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    const unixMode = entry.symlink ? 0o120777 : (isDirectory ? 0o040755 : 0o100644);
    centralHeader.writeUInt32LE((unixMode << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);

    localParts.push(localHeader, nameBytes, compressed);
    centralParts.push(centralHeader, nameBytes);
    localOffset += localHeader.length + nameBytes.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

test('unwraps single-folder zip archives, strips macOS metadata, and avoids collisions', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localtex-zip-test-'));
  try {
    const zipBuffer = buildZipBuffer([
      { name: 'PaperWrapper/', data: '' },
      { name: 'PaperWrapper/main.tex', data: '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n', streaming: true },
      { name: 'PaperWrapper/章节/引言.tex', data: '中文内容\n' },
      { name: 'PaperWrapper/.DS_Store', data: 'junk' },
      { name: '__MACOSX/PaperWrapper/._main.tex', data: 'resource-fork' },
      { name: 'PaperWrapper/evil-link', data: '/etc/passwd', symlink: true },
    ]);

    const first = await importZipProjectToWorkspace(zipBuffer, 'Overleaf 论文.zip', tempRoot);
    assert.equal(path.basename(first.projectPath), 'Overleaf 论文');
    assert.equal(first.extractedFileCount, 2);
    assert.equal(fs.existsSync(path.join(first.projectPath, 'main.tex')), true);
    assert.equal(fs.readFileSync(path.join(first.projectPath, '章节', '引言.tex'), 'utf8'), '中文内容\n');
    assert.equal(fs.existsSync(path.join(first.projectPath, '.DS_Store')), false);
    assert.equal(fs.existsSync(path.join(first.projectPath, 'evil-link')), false);

    const second = await importZipProjectToWorkspace(zipBuffer, 'Overleaf 论文.zip', tempRoot);
    assert.equal(path.basename(second.projectPath), 'Overleaf 论文-2');
    assert.equal(fs.existsSync(path.join(second.projectPath, 'main.tex')), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('rejects zip-slip path traversal and absolute paths before writing files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localtex-zip-sec-'));
  try {
    const traversalZip = buildZipBuffer([
      { name: '../../outside.tex', data: 'blocked' },
    ]);
    await assert.rejects(
      () => extractZipBufferToDirectory(traversalZip, tempRoot),
      /越界路径/,
    );

    const absoluteZip = buildZipBuffer([
      { name: '/etc/evil.tex', data: 'blocked' },
    ]);
    await assert.rejects(
      () => extractZipBufferToDirectory(absoluteZip, tempRoot),
      /绝对路径/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
