// Generates PWA/Apple icons (black bg + white play glyph) with no image deps.
import zlib from "zlib";
import fs from "fs";
import path from "path";

const OUT = path.resolve("public");
fs.mkdirSync(OUT, { recursive: true });

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body), 0);
  return Buffer.concat([len, body, crc]);
}

function makePng(size) {
  const cx = size / 2, cy = size / 2;
  // play triangle geometry
  const triH = size * 0.34;
  const triW = size * 0.30;
  const tx = cx - triW * 0.32;        // slight optical shift
  const ringR = size * 0.34;
  const ringW = size * 0.045;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter byte: none
    for (let x = 0; x < size; x++) {
      let v = 0; // black
      // ring
      const d = Math.hypot(x - cx, y - cy);
      if (d <= ringR && d >= ringR - ringW) v = 255;
      // play triangle (pointing right)
      const ty0 = cy - triH / 2, ty1 = cy + triH / 2;
      if (y >= ty0 && y <= ty1) {
        const frac = (y - ty0) / triH;          // 0..1 top→bottom
        const half = Math.min(frac, 1 - frac) * 2; // 0 at tips, 1 mid
        const xEnd = tx + triW * half;
        if (x >= tx && x <= xEnd) v = 255;
      }
      raw[p++] = v; raw[p++] = v; raw[p++] = v; raw[p++] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  fs.writeFileSync(path.join(OUT, name), makePng(size));
  console.log("wrote", name, size);
}
