import { Inflate } from "fflate";
import { fail, HighTexImportError } from "./errors.js";
import type { ImportLimits } from "./types.js";

const decoder = new TextDecoder("utf-8", { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function validatePath(name: string): void {
  const parts = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  if (
    !name ||
    /[\\:\x00-\x1f\x7f]/.test(name) ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    fail(
      "invalid_path",
      "Archive paths must be relative and unambiguous",
      name,
    );
}

/** ZIP32, stored/deflate. Inspect the complete directory before decompressing any entry. */
export function readArchive(
  bytes: Uint8Array,
  limits: ImportLimits,
): Record<string, Uint8Array> {
  if (bytes.byteLength > limits.maxArchiveBytes)
    fail("too_large", "Archive exceeds byte limit");
  if (bytes.length < 22) fail("invalid_archive", "ZIP end record is missing");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--)
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length)
      break;
  if (end < Math.max(0, bytes.length - 65557))
    fail("invalid_archive", "ZIP end record is missing");
  const count = u16(end + 10),
    directorySize = u32(end + 12),
    directoryOffset = u32(end + 16);
  if (
    u16(end + 4) ||
    u16(end + 6) ||
    u16(end + 8) !== count ||
    count === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  )
    fail(
      "unsupported_archive",
      "Multi-disk and ZIP64 archives are not supported",
    );
  if (count > limits.maxEntries)
    fail("too_large", "Archive has too many entries");
  if (directoryOffset + directorySize !== end)
    fail("invalid_archive", "Invalid central directory bounds");
  const records: {
    name: string;
    start: number;
    size: number;
    original: number;
    method: number;
    crc: number;
    offset: number;
  }[] = [];
  const seen = new Set<string>();
  let cursor = directoryOffset,
    total = 0;
  try {
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > end || u32(cursor) !== 0x02014b50)
        fail("invalid_archive", "Invalid central directory entry");
      const flags = u16(cursor + 8),
        method = u16(cursor + 10),
        crc = u32(cursor + 16);
      const size = u32(cursor + 20),
        original = u32(cursor + 24),
        nameSize = u16(cursor + 28);
      const next = cursor + 46 + nameSize + u16(cursor + 30) + u16(cursor + 32);
      const offset = u32(cursor + 42);
      if (
        next > end ||
        !nameSize ||
        u16(cursor + 34) ||
        offset === 0xffffffff ||
        size === 0xffffffff ||
        original === 0xffffffff
      )
        fail("invalid_archive", "Invalid or unsupported ZIP entry");
      if (flags & ~0x080e || ![0, 8].includes(method))
        fail(
          "unsupported_archive",
          "Only unencrypted stored/deflate entries are supported",
        );
      const name = decoder.decode(
        bytes.subarray(cursor + 46, cursor + 46 + nameSize),
      );
      validatePath(name);
      // A file and directory with the same normalized path are ambiguous too.
      const key = name.replace(/\/$/, "");
      if (seen.has(key))
        fail("duplicate_entry", "Duplicate archive path", name);
      seen.add(key);
      total += original;
      if (
        original > limits.maxEntryBytes ||
        total > limits.maxUncompressedBytes
      )
        fail("too_large", "Declared uncompressed size exceeds limit", name);
      if (
        offset + 30 > directoryOffset ||
        u32(offset) !== 0x04034b50 ||
        u16(offset + 6) !== flags ||
        u16(offset + 8) !== method
      )
        fail("invalid_archive", "Local and central headers disagree", name);
      const localNameSize = u16(offset + 26);
      const start = offset + 30 + localNameSize + u16(offset + 28);
      if (
        start + size > directoryOffset ||
        decoder.decode(
          bytes.subarray(offset + 30, offset + 30 + localNameSize),
        ) !== name
      )
        fail("invalid_archive", "Invalid local entry bounds or name", name);
      if (
        !(flags & 8) &&
        (u32(offset + 14) !== crc ||
          u32(offset + 18) !== size ||
          u32(offset + 22) !== original)
      )
        fail("invalid_archive", "Local and central sizes/CRC disagree", name);
      if (method === 0 && size !== original)
        fail("invalid_archive", "Stored entry size mismatch", name);
      if (name.endsWith("/") && original)
        fail("invalid_archive", "Directory contains file data", name);
      records.push({ name, start, size, original, method, crc, offset });
      cursor = next;
    }
    if (cursor !== end)
      fail("invalid_archive", "Unexpected central directory data");
    const ranges = [...records].sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < ranges.length; i++)
      if (ranges[i].offset < ranges[i - 1].start + ranges[i - 1].size)
        fail("invalid_archive", "Archive entries overlap", ranges[i].name);

    const entries: Record<string, Uint8Array> = Object.create(null);
    for (const record of records) {
      const compressed = bytes.subarray(
        record.start,
        record.start + record.size,
      );
      let content: Uint8Array;
      if (record.method === 0) content = compressed.slice();
      else {
        // Fixed-size output and small input chunks prevent a forged size header
        // from making decompression allocate an unbounded result.
        content = new Uint8Array(record.original);
        let written = 0;
        const inflater = new Inflate((chunk) => {
          if (
            written + chunk.length > record.original ||
            written + chunk.length > limits.maxEntryBytes
          )
            fail(
              "too_large",
              "Inflated data exceeds declared size or limit",
              record.name,
            );
          content.set(chunk, written);
          written += chunk.length;
        });
        if (!compressed.length)
          fail("invalid_archive", "Empty deflate stream", record.name);
        for (let i = 0; i < compressed.length; i += 1024)
          inflater.push(
            compressed.subarray(i, i + 1024),
            i + 1024 >= compressed.length,
          );
        if (written !== record.original)
          fail("invalid_archive", "Inflated size mismatch", record.name);
      }
      if (crc32(content) !== record.crc)
        fail("invalid_archive", "Entry checksum mismatch", record.name);
      if (!record.name.endsWith("/")) entries[record.name] = content;
    }
    return normalizeRoot(entries);
  } catch (error) {
    if (error instanceof HighTexImportError) throw error;
    fail("invalid_archive", "Archive contains corrupt entry data");
  }
}

function normalizeRoot(
  entries: Record<string, Uint8Array>,
): Record<string, Uint8Array> {
  const names = Object.keys(entries);
  const manifests = names.filter(
    (name) => name === "manifest.json" || name.endsWith("/manifest.json"),
  );
  if (!manifests.length) fail("manifest_missing", "manifest.json is required");
  if (manifests.length !== 1)
    fail("invalid_archive", "Archive contains multiple manifests");
  const root = manifests[0].slice(0, -"manifest.json".length);
  if (
    root &&
    (root.split("/").length !== 2 ||
      names.some((name) => !name.startsWith(root)))
  )
    fail("invalid_archive", "Only one consistent wrapping folder is supported");
  return Object.fromEntries(
    names.map((name) => [name.slice(root.length), entries[name]]),
  );
}
