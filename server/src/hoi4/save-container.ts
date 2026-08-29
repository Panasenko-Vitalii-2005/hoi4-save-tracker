import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { crc32, inflateRawSync } from 'node:zlib';
import { decodeSaveText } from './save-text.decoder';
import { SaveInputError } from './save-input.error';
import {
  MAX_ZIP_DIRECTORY_BYTES,
  MAX_ZIP_ENTRIES,
  saveUploadPolicy,
  type SaveUploadPolicy,
} from './save-upload.policy';
import type { LocatedBlock } from './naval-loss/global-history.parser';

const ZIP_TAIL_BYTES = 22 + 65535;
const corrupt = () => new SaveInputError('CORRUPT_ARCHIVE');
const unsupported = () => new SaveInputError('UNSUPPORTED_SAVE');

function checkSize(size: number, policy: SaveUploadPolicy) {
  if (size === 0) throw new SaveInputError('EMPTY_FILE');
  if (size > policy.maxUploadBytes) throw new SaveInputError('FILE_TOO_LARGE');
}

function checkPlainPrefix(prefix: Buffer) {
  const text = prefix.toString('utf8').replace(/^\uFEFF/, '');
  if (/^HOI4bin(?:\s|$)/.test(text)) throw unsupported();
  if (!/^HOI4txt(?:\s|$)/.test(text) || text.includes('\0'))
    throw new SaveInputError('INVALID_SAVE');
}

function zipDirectory(tail: Buffer, size: number) {
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (
      tail.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + tail.readUInt16LE(i + 20) === tail.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw corrupt();
  const count = tail.readUInt16LE(end + 10);
  const bytes = tail.readUInt32LE(end + 12);
  const offset = tail.readUInt32LE(end + 16);
  if (tail.readUInt32LE(end + 4) !== 0 || count !== tail.readUInt16LE(end + 8))
    throw unsupported(); // No split archives.
  if (count > MAX_ZIP_ENTRIES || count === 0 || bytes > MAX_ZIP_DIRECTORY_BYTES)
    throw unsupported();
  if (offset + bytes !== size - tail.length + end) throw corrupt();
  return { count, bytes, offset };
}

function checkExtra(extra: Buffer) {
  let position = 0;
  while (position < extra.length) {
    if (position + 4 > extra.length) throw corrupt();
    if (extra.readUInt16LE(position) === 1) throw unsupported(); // ZIP64.
    position += 4 + extra.readUInt16LE(position + 2);
  }
  if (position !== extra.length) throw corrupt();
}

function zipEntry(directory: Buffer, count: number, policy: SaveUploadPolicy) {
  // Supported container: one save payload, not an arbitrary multi-file archive.
  if (count !== 1) throw unsupported();
  if (directory.length < 46 || directory.readUInt32LE(0) !== 0x02014b50)
    throw corrupt();
  const nameLength = directory.readUInt16LE(28);
  const extraLength = directory.readUInt16LE(30);
  const commentLength = directory.readUInt16LE(32);
  if (46 + nameLength + extraLength + commentLength !== directory.length)
    throw corrupt();
  const name = directory.subarray(46, 46 + nameLength);
  const label = name.toString('utf8');
  const hasControlCharacter = Array.from(label).some(
    (character) => character.codePointAt(0)! < 32,
  );
  const flags = directory.readUInt16LE(8);
  const method = directory.readUInt16LE(10);
  const compressedSize = directory.readUInt32LE(20);
  const size = directory.readUInt32LE(24);
  const mode = directory.readUInt32LE(38) >>> 16;
  if (
    hasControlCharacter ||
    (label !== 'gamestate' && !/^[^/\\]+\.hoi4$/i.test(label)) ||
    label.includes('..') ||
    (mode & 0xf000) === 0xa000 ||
    (mode & 0xf000) === 0x4000 ||
    (flags & ~0x080e) !== 0 ||
    ![0, 8].includes(method) ||
    directory.readUInt16LE(34) !== 0 ||
    directory.readUInt32LE(42) !== 0 ||
    compressedSize === 0xffffffff ||
    size === 0xffffffff
  )
    throw unsupported();
  checkExtra(
    directory.subarray(46 + nameLength, 46 + nameLength + extraLength),
  );
  if (size > policy.maxUncompressedBytes)
    throw new SaveInputError('DECOMPRESSED_SIZE_LIMIT');
  return {
    name,
    flags,
    method,
    compressedSize,
    size,
    crc: directory.readUInt32LE(16),
  };
}

type ZipEntry = ReturnType<typeof zipEntry>;

function zipDataOffset(
  local: Buffer,
  entry: ZipEntry,
  directoryOffset: number,
) {
  if (
    local.length < 30 ||
    local.readUInt32LE(0) !== 0x04034b50 ||
    local.readUInt16LE(6) !== entry.flags ||
    local.readUInt16LE(8) !== entry.method
  )
    throw corrupt();
  const offset = 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  if (offset + entry.compressedSize > directoryOffset) throw corrupt();
  if (
    !(entry.flags & 8) &&
    (local.readUInt32LE(14) !== entry.crc ||
      local.readUInt32LE(18) !== entry.compressedSize ||
      local.readUInt32LE(22) !== entry.size)
  )
    throw corrupt();
  return offset;
}

function checkLocalNames(local: Buffer, entry: ZipEntry) {
  const nameLength = local.readUInt16LE(26);
  if (!local.subarray(30, 30 + nameLength).equals(entry.name)) throw corrupt();
  checkExtra(local.subarray(30 + nameLength));
}

function checkDescriptor(descriptor: Buffer, entry: ZipEntry) {
  if (!(entry.flags & 8)) {
    if (descriptor.length) throw corrupt();
    return;
  }
  const start =
    descriptor.length === 16 && descriptor.readUInt32LE(0) === 0x08074b50
      ? 4
      : 0;
  if (
    descriptor.length !== start + 12 ||
    descriptor.readUInt32LE(start) !== entry.crc ||
    descriptor.readUInt32LE(start + 4) !== entry.compressedSize ||
    descriptor.readUInt32LE(start + 8) !== entry.size
  )
    throw corrupt();
}

/** Bounded prefix/ZIP metadata reads only. No whole-save read or inflation here. */
export async function validateSaveFile(
  filePath: string,
  policy = saveUploadPolicy(),
): Promise<void> {
  const file = await open(filePath, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new SaveInputError('INVALID_SAVE');
    checkSize(stat.size, policy);
    const read = async (offset: number, length: number) => {
      if (offset < 0 || length < 0 || offset + length > stat.size)
        throw corrupt();
      const data = Buffer.alloc(length);
      let done = 0;
      while (done < length) {
        const { bytesRead } = await file.read(
          data,
          done,
          length - done,
          offset + done,
        );
        if (!bytesRead) throw corrupt();
        done += bytesRead;
      }
      return data;
    };
    const prefix = await read(0, Math.min(stat.size, 64));
    if (prefix[0] !== 0x50 || prefix[1] !== 0x4b) {
      if (stat.size > policy.maxUncompressedBytes)
        throw new SaveInputError('DECOMPRESSED_SIZE_LIMIT');
      checkPlainPrefix(prefix);
      return;
    }
    const tailSize = Math.min(stat.size, ZIP_TAIL_BYTES);
    const index = zipDirectory(
      await read(stat.size - tailSize, tailSize),
      stat.size,
    );
    const entry = zipEntry(
      await read(index.offset, index.bytes),
      index.count,
      policy,
    );
    const offset = zipDataOffset(await read(0, 30), entry, index.offset);
    checkLocalNames(await read(0, offset), entry);
    const end = offset + entry.compressedSize;
    if (index.offset - end > 16) throw corrupt();
    checkDescriptor(await read(end, index.offset - end), entry);
  } finally {
    await file.close();
  }
}

/** The Worker performs the only full read/decode. No disk extraction. */
export function readSaveText(
  filePath: string,
  validateInput = false,
  policy = saveUploadPolicy(),
): string {
  const file = openSync(filePath, 'r');
  let bytes: Buffer;
  try {
    const stat = fstatSync(file);
    if (!stat.isFile()) throw new SaveInputError('INVALID_SAVE');
    checkSize(stat.size, policy);
    const prefix = Buffer.alloc(Math.min(stat.size, 64));
    if (readSync(file, prefix, 0, prefix.length, 0) !== prefix.length)
      throw new SaveInputError('INVALID_SAVE');
    if (prefix[0] !== 0x50 || prefix[1] !== 0x4b) {
      if (stat.size > policy.maxUncompressedBytes)
        throw new SaveInputError('DECOMPRESSED_SIZE_LIMIT');
      if (validateInput) checkPlainPrefix(prefix);
    }
    bytes = Buffer.allocUnsafe(stat.size);
    let done = 0;
    while (done < bytes.length) {
      const length = readSync(file, bytes, done, bytes.length - done, done);
      if (!length) throw new SaveInputError('INVALID_SAVE');
      done += length;
    }
    if (readSync(file, Buffer.alloc(1), 0, 1, done))
      throw new SaveInputError('FILE_TOO_LARGE');
  } finally {
    closeSync(file);
  }
  let plain = bytes;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      const index = zipDirectory(bytes.subarray(-ZIP_TAIL_BYTES), bytes.length);
      const entry = zipEntry(
        bytes.subarray(index.offset, index.offset + index.bytes),
        index.count,
        policy,
      );
      const offset = zipDataOffset(bytes.subarray(0, 30), entry, index.offset);
      checkLocalNames(bytes.subarray(0, offset), entry);
      const end = offset + entry.compressedSize;
      checkDescriptor(bytes.subarray(end, index.offset), entry);
      const compressed = bytes.subarray(offset, end);
      plain =
        entry.method === 0
          ? compressed
          : inflateRawSync(compressed, {
              // Independent hard cap, including when declared size is forged or zero.
              maxOutputLength: policy.maxUncompressedBytes,
            });
      if (plain.length > policy.maxUncompressedBytes)
        throw new SaveInputError('DECOMPRESSED_SIZE_LIMIT');
      if (plain.length !== entry.size || crc32(plain) !== entry.crc)
        throw corrupt();
    } catch (error: unknown) {
      if (error instanceof SaveInputError) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ERR_BUFFER_TOO_LARGE'
      )
        throw new SaveInputError('DECOMPRESSED_SIZE_LIMIT');
      throw corrupt();
    }
  }
  if (plain.length > policy.maxUncompressedBytes)
    throw new SaveInputError('DECOMPRESSED_SIZE_LIMIT');
  if (validateInput) checkPlainPrefix(plain.subarray(0, 64));
  return decodeSaveText(plain);
}

/** Reuse the existing index: check gaps, never rescan the large block bodies. */
export function validateSaveStructure(
  content: string,
  blocks: readonly LocatedBlock[],
) {
  let previous = 0;
  for (const block of blocks) {
    if (!block.complete) throw new SaveInputError('INVALID_SAVE');
    checkGap(content, previous, block.bodyStart - 1);
    previous = block.bodyEnd + 1;
  }
  checkGap(content, previous, content.length);
}

function checkGap(content: string, start: number, end: number) {
  let quoted = false;
  for (let i = start; i < end; i++) {
    const char = content[i];
    if (quoted && char === '\\') {
      i++;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted && char === '#') {
      while (i < end && content[i] !== '\n') i++;
    } else if (!quoted && (char === '{' || char === '}')) {
      throw new SaveInputError('INVALID_SAVE');
    }
  }
  if (quoted) throw new SaveInputError('INVALID_SAVE');
}
