const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { randomUUID } = require('node:crypto');

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

const MAX_ZIP_ENTRIES = 5_000;
const MAX_SINGLE_FILE_BYTES = 150 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;

const utf8FatalDecoder = new TextDecoder('utf-8', { fatal: true });
let legacyCjkDecoder = null;
try {
  legacyCjkDecoder = new TextDecoder('gb18030');
} catch {
  legacyCjkDecoder = null;
}

function decodeZipFileName(rawBytes, utf8Flag) {
  if (utf8Flag) return rawBytes.toString('utf8');
  try {
    return utf8FatalDecoder.decode(rawBytes);
  } catch {
    if (legacyCjkDecoder) return legacyCjkDecoder.decode(rawBytes);
    return rawBytes.toString('latin1');
  }
}

function sanitizeProjectFolderName(zipFileName = '') {
  const base = String(zipFileName || '')
    .replaceAll('\\', '/')
    .split('/')
    .pop()
    .replace(/\.zip$/i, '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim();
  return (base || 'imported-project').slice(0, 80);
}

function normalizeZipEntryPath(rawEntryName) {
  const raw = String(rawEntryName || '');
  if (!raw || raw.includes('\0')) {
    throw new Error('压缩包包含无效的文件名。');
  }
  const unified = raw.replaceAll('\\', '/');
  if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified)) {
    throw new Error('压缩包包含不安全的绝对路径，已拒绝导入。');
  }
  const isDirectory = unified.endsWith('/');
  const rawSegments = unified.split('/');
  const segments = [];
  for (const segment of rawSegments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      throw new Error('压缩包包含不安全的越界路径（..），已拒绝导入。');
    }
    segments.push(segment);
  }
  if (!segments.length) return { skip: true };

  if (segments.includes('__MACOSX')) return { skip: true };
  const baseName = segments.at(-1);
  if (baseName === '.DS_Store' || baseName === 'Thumbs.db' || baseName.startsWith('._')) {
    return { skip: true };
  }

  return {
    skip: false,
    isDirectory,
    relativePath: segments.join('/'),
  };
}

function findEndOfCentralDirectory(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new Error('不是有效的 .zip 压缩包。');
  }
  const minOffset = Math.max(0, buffer.length - 65557);
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength <= buffer.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('无法解析 .zip 目录结构，请确认文件完整且为标准 .zip 格式。');
  }

  let totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let cdSize = buffer.readUInt32LE(eocdOffset + 12);
  let cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (
    (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    && eocdOffset >= 20
    && buffer.readUInt32LE(eocdOffset - 20) === ZIP64_EOCD_LOCATOR_SIGNATURE
  ) {
    const zip64Offset = Number(buffer.readBigUInt64LE(eocdOffset - 12));
    if (
      zip64Offset >= 0
      && zip64Offset + 56 <= buffer.length
      && buffer.readUInt32LE(zip64Offset) === ZIP64_EOCD_SIGNATURE
    ) {
      totalEntries = Number(buffer.readBigUInt64LE(zip64Offset + 32));
      cdSize = Number(buffer.readBigUInt64LE(zip64Offset + 40));
      cdOffset = Number(buffer.readBigUInt64LE(zip64Offset + 48));
    }
  }

  if (cdOffset < 0 || cdSize < 0 || cdOffset + cdSize > buffer.length) {
    throw new Error('.zip 压缩包目录已损坏。');
  }

  return { totalEntries, cdSize, cdOffset };
}

function parseZip64Extra(extraBuffer, { uncompressedSize, compressedSize, localHeaderOffset }) {
  let cursor = 0;
  let nextUncompressed = uncompressedSize;
  let nextCompressed = compressedSize;
  let nextLocalOffset = localHeaderOffset;

  while (cursor + 4 <= extraBuffer.length) {
    const headerId = extraBuffer.readUInt16LE(cursor);
    const dataSize = extraBuffer.readUInt16LE(cursor + 2);
    const dataStart = cursor + 4;
    const dataEnd = dataStart + dataSize;
    if (dataEnd > extraBuffer.length) break;
    if (headerId === 0x0001) {
      let fieldCursor = dataStart;
      if (nextUncompressed === 0xffffffff && fieldCursor + 8 <= dataEnd) {
        nextUncompressed = Number(extraBuffer.readBigUInt64LE(fieldCursor));
        fieldCursor += 8;
      }
      if (nextCompressed === 0xffffffff && fieldCursor + 8 <= dataEnd) {
        nextCompressed = Number(extraBuffer.readBigUInt64LE(fieldCursor));
        fieldCursor += 8;
      }
      if (nextLocalOffset === 0xffffffff && fieldCursor + 8 <= dataEnd) {
        nextLocalOffset = Number(extraBuffer.readBigUInt64LE(fieldCursor));
      }
      break;
    }
    cursor = dataEnd;
  }

  return {
    uncompressedSize: nextUncompressed,
    compressedSize: nextCompressed,
    localHeaderOffset: nextLocalOffset,
  };
}

function ensureInsideDirectory(rootDirectory, relativePath) {
  const root = path.resolve(rootDirectory);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('压缩包路径越界，已拒绝解压。');
  }
  return resolved;
}

async function extractZipBufferToDirectory(zipBuffer, destinationDirectory) {
  const { totalEntries, cdSize, cdOffset } = findEndOfCentralDirectory(zipBuffer);
  if (totalEntries > MAX_ZIP_ENTRIES) {
    throw new Error(`压缩包内文件数量过多（超过 ${MAX_ZIP_ENTRIES} 个）。`);
  }

  const endOffset = cdOffset + cdSize;
  let cursor = cdOffset;
  let parsedEntries = 0;
  let totalUncompressedBytes = 0;
  let extractedFileCount = 0;

  while (cursor < endOffset) {
    if (cursor + 46 > zipBuffer.length || zipBuffer.readUInt32LE(cursor) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error('.zip 中央目录记录损坏。');
    }
    parsedEntries += 1;
    if (parsedEntries > MAX_ZIP_ENTRIES) {
      throw new Error(`压缩包内文件数量过多（超过 ${MAX_ZIP_ENTRIES} 个）。`);
    }

    const versionMadeBy = zipBuffer.readUInt16LE(cursor + 4);
    const flags = zipBuffer.readUInt16LE(cursor + 8);
    const compressionMethod = zipBuffer.readUInt16LE(cursor + 10);
    let compressedSize = zipBuffer.readUInt32LE(cursor + 20);
    let uncompressedSize = zipBuffer.readUInt32LE(cursor + 24);
    const fileNameLength = zipBuffer.readUInt16LE(cursor + 28);
    const extraLength = zipBuffer.readUInt16LE(cursor + 30);
    const commentLength = zipBuffer.readUInt16LE(cursor + 32);
    const externalAttributes = zipBuffer.readUInt32LE(cursor + 38);
    let localHeaderOffset = zipBuffer.readUInt32LE(cursor + 42);

    const nameStart = cursor + 46;
    const extraStart = nameStart + fileNameLength;
    const nextCursor = extraStart + extraLength + commentLength;
    if (nextCursor > zipBuffer.length) {
      throw new Error('.zip 文件条目超出压缩包范围。');
    }

    if ((flags & 0x0001) !== 0) {
      throw new Error('暂不支持加密（带密码）的 .zip 压缩包，请先解压后再打开。');
    }

    const rawNameBytes = zipBuffer.subarray(nameStart, extraStart);
    const rawFileName = decodeZipFileName(rawNameBytes, (flags & 0x0800) !== 0);

    if (
      uncompressedSize === 0xffffffff
      || compressedSize === 0xffffffff
      || localHeaderOffset === 0xffffffff
    ) {
      const extraSlice = zipBuffer.subarray(extraStart, extraStart + extraLength);
      ({ uncompressedSize, compressedSize, localHeaderOffset } = parseZip64Extra(extraSlice, {
        uncompressedSize,
        compressedSize,
        localHeaderOffset,
      }));
    }

    cursor = nextCursor;

    const createdByUnix = (versionMadeBy >>> 8) === 3;
    if (createdByUnix && ((externalAttributes >>> 16) & 0o170000) === 0o120000) {
      // Skip symbolic links inside archives for safety.
      continue;
    }

    const normalized = normalizeZipEntryPath(rawFileName);
    if (normalized.skip) continue;

    const targetPath = ensureInsideDirectory(destinationDirectory, normalized.relativePath);
    if (normalized.isDirectory) {
      await fsp.mkdir(targetPath, { recursive: true });
      continue;
    }

    if (uncompressedSize > MAX_SINGLE_FILE_BYTES) {
      throw new Error(`压缩包中的单个文件过大：${normalized.relativePath}`);
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('压缩包解压后总体积超过安全上限（500 MB）。');
    }

    if (
      localHeaderOffset < 0
      || localHeaderOffset + 30 > zipBuffer.length
      || zipBuffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE
    ) {
      throw new Error(`压缩包本地文件头损坏：${normalized.relativePath}`);
    }

    const localNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart < 0 || dataEnd > zipBuffer.length) {
      throw new Error(`压缩包文件数据不完整：${normalized.relativePath}`);
    }

    const compressedSlice = zipBuffer.subarray(dataStart, dataEnd);
    let content;
    if (compressionMethod === 0) {
      content = compressedSlice;
    } else if (compressionMethod === 8) {
      content = zlib.inflateRawSync(compressedSlice, {
        maxOutputLength: MAX_SINGLE_FILE_BYTES,
      });
    } else {
      throw new Error(`压缩包使用了暂不支持的压缩方式（method ${compressionMethod}），请先在 Finder 双击解压后打开文件夹。`);
    }

    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, content);
    extractedFileCount += 1;
  }

  if (extractedFileCount === 0) {
    throw new Error('压缩包中没有可导入的项目文件。');
  }

  return { extractedFileCount };
}

async function unwrapSingleRootDirectory(directory, maxDepth = 4) {
  let current = directory;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const entries = (await fsp.readdir(current, { withFileTypes: true }))
      .filter((entry) => entry.name !== '.DS_Store' && entry.name !== '__MACOSX');
    if (entries.length !== 1 || !entries[0].isDirectory()) break;
    current = path.join(current, entries[0].name);
  }
  return current;
}

function allocateUniqueProjectDirectory(workspaceRoot, preferredName) {
  const stem = sanitizeProjectFolderName(preferredName);
  const firstCandidate = path.join(workspaceRoot, stem);
  if (!fs.existsSync(firstCandidate)) return firstCandidate;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = path.join(workspaceRoot, `${stem}-${suffix}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(workspaceRoot, `${stem}-${randomUUID().slice(0, 8)}`);
}

async function importZipProjectToWorkspace(zipBuffer, zipFileName, workspaceRoot) {
  await fsp.mkdir(workspaceRoot, { recursive: true });
  const stagingRoot = path.join(workspaceRoot, `.zip-import-${randomUUID()}`);
  await fsp.mkdir(stagingRoot, { recursive: true });

  try {
    const { extractedFileCount } = await extractZipBufferToDirectory(zipBuffer, stagingRoot);
    const contentRoot = await unwrapSingleRootDirectory(stagingRoot);
    const targetDirectory = allocateUniqueProjectDirectory(workspaceRoot, zipFileName);
    await fsp.rename(contentRoot, targetDirectory);
    return {
      projectPath: targetDirectory,
      extractedFileCount,
    };
  } finally {
    await fsp.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  allocateUniqueProjectDirectory,
  extractZipBufferToDirectory,
  importZipProjectToWorkspace,
  normalizeZipEntryPath,
  sanitizeProjectFolderName,
};
