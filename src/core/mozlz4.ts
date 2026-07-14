// Firefox session files (sessionstore-backups/recovery.jsonlz4) use "mozLz4":
// an 8-byte magic "mozLz40\0", a 4-byte little-endian decompressed size, then a
// raw LZ4 *block* (not the LZ4 frame format). Decompress it ourselves — the
// block format is compact and self-contained, and a hand-rolled decoder is
// verifiable (decompress the real file → JSON.parse succeeds).

const MAGIC = "mozLz40\0";

export function decodeMozLz4(buf: Uint8Array): string {
  const magic = new TextDecoder("latin1").decode(buf.subarray(0, 8));
  if (magic !== MAGIC) throw new Error("not a mozLz4 file (bad magic)");
  const size =
    buf[8] | (buf[9] << 8) | (buf[10] << 16) | (buf[11] << 24); // LE uint32
  const out = lz4BlockDecompress(buf.subarray(12), size >>> 0);
  return new TextDecoder("utf-8").decode(out);
}

// Raw LZ4 block decompression. Sequence of: token, literals, then a match copy.
function lz4BlockDecompress(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let sp = 0; // src pos
  let op = 0; // out pos

  while (sp < src.length) {
    const token = src[sp++];

    // literals
    let litLen = token >> 4;
    if (litLen === 15) {
      let b: number;
      do {
        b = src[sp++];
        litLen += b;
      } while (b === 255);
    }
    for (let i = 0; i < litLen; i++) out[op++] = src[sp++];

    if (sp >= src.length) break; // last sequence is literals-only

    // match
    const offset = src[sp++] | (src[sp++] << 8); // LE uint16
    let matchLen = token & 0x0f;
    if (matchLen === 15) {
      let b: number;
      do {
        b = src[sp++];
        matchLen += b;
      } while (b === 255);
    }
    matchLen += 4; // minimum match length

    let mp = op - offset; // may overlap with output being written
    for (let i = 0; i < matchLen; i++) out[op++] = out[mp++];
  }
  return out.subarray(0, op);
}
