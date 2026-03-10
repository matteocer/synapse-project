// Minimal QR generator (versions 1-4, error level L, mask pattern 0).
// Enough for join URLs used in this app. No external dependencies.

const VERSION_TABLE = {
  1: { size: 21, dataCodewords: 19, ecCodewords: 7, remainderBits: 0 },
  2: { size: 25, dataCodewords: 34, ecCodewords: 10, remainderBits: 7 },
  3: { size: 29, dataCodewords: 55, ecCodewords: 15, remainderBits: 7 },
  4: { size: 33, dataCodewords: 80, ecCodewords: 20, remainderBits: 7 },
};

const EC_LEVEL = 'L'; // fixed to keep implementation small
const MASK_PATTERN = 0; // (row + col) % 2 === 0

// Galois field tables for Reed-Solomon (GF(256) with poly 0x11d)
const GF_EXP = new Array(512);
const GF_LOG = new Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function polyMultiply(p, q) {
  const result = new Array(p.length + q.length - 1).fill(0);
  for (let i = 0; i < p.length; i += 1) {
    for (let j = 0; j < q.length; j += 1) {
      result[i + j] ^= gfMul(p[i], q[j]);
    }
  }
  return result;
}

function buildGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    poly = polyMultiply(poly, [1, GF_EXP[i]]);
  }
  return poly;
}

function reedSolomon(data, ecLen) {
  const gen = buildGenerator(ecLen);
  const result = new Array(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i += 1) {
        result[i] ^= gfMul(gen[i], factor);
      }
    }
  }
  return result;
}

function utf8Bytes(text) {
  return new TextEncoder().encode(text);
}

function chooseVersion(byteLength) {
  for (let v = 1; v <= 4; v += 1) {
    const capBits = VERSION_TABLE[v].dataCodewords * 8;
    const payloadBits = 4 + 8 + byteLength * 8; // mode + length + data
    if (payloadBits <= capBits) return v;
  }
  return null;
}

function buildDataCodewords(text, version) {
  const { dataCodewords } = VERSION_TABLE[version];
  const bytes = Array.from(utf8Bytes(text));
  const bits = [];
  const pushBits = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) {
      bits.push((value >> i) & 1);
    }
  };
  // Mode: byte (0100)
  pushBits(0b0100, 4);
  // Length
  pushBits(bytes.length, 8);
  // Data
  bytes.forEach((b) => pushBits(b, 8));

  // Terminator
  const capacity = dataCodewords * 8;
  const remaining = capacity - bits.length;
  if (remaining > 0) {
    const terminator = Math.min(4, remaining);
    for (let i = 0; i < terminator; i += 1) bits.push(0);
  }

  // Pad to byte
  while (bits.length % 8 !== 0) bits.push(0);

  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (bits.length < capacity) {
    pushBits(pads[padIndex % 2], 8);
    padIndex += 1;
  }

  // Convert to bytes
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j += 1) {
      val = (val << 1) | bits[i + j];
    }
    codewords.push(val);
  }
  return codewords;
}

function addFinder(matrix, top, left) {
  const pattern = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      matrix[top + r][left + c] = pattern[r][c] === 1;
    }
  }
  // Separator
  for (let i = -1; i <= 7; i += 1) {
    for (let j = -1; j <= 7; j += 1) {
      const r = top + i;
      const c = left + j;
      if (r < 0 || c < 0 || r >= matrix.length || c >= matrix.length) continue;
      if (r >= top && r < top + 7 && c >= left && c < left + 7) continue;
      if (matrix[r][c] === null) matrix[r][c] = false;
    }
  }
}

function addAlignment(matrix, rowCenter, colCenter) {
  const pattern = [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ];
  const top = rowCenter - 2;
  const left = colCenter - 2;
  for (let r = 0; r < 5; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      const R = top + r;
      const C = left + c;
      if (matrix[R][C] === null) {
        matrix[R][C] = pattern[r][c] === 1;
      }
    }
  }
}

function addTiming(matrix) {
  const size = matrix.length;
  for (let i = 0; i < size; i += 1) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
  }
}

function reserveFormatAreas(matrix) {
  const size = matrix.length;
  const reserve = (r, c) => {
    if (matrix[r][c] === null) matrix[r][c] = false;
  };
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      reserve(8, i);
      reserve(i, 8);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    reserve(size - 1 - i, 8);
    reserve(8, size - 1 - i);
  }
  reserve(8, 8); // center
}

// Format info helper
function formatBits(maskPattern) {
  const ECL_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };
  const data = (ECL_BITS[EC_LEVEL] << 3) | maskPattern; // 5 bits
  let format = data << 10;
  const poly = 0b10100110111;
  for (let i = 14; i >= 10; i -= 1) {
    if ((format >> i) & 1) {
      format ^= poly << (i - 10);
    }
  }
  format = ((data << 10) | (format & 0x3ff)) ^ 0b101010000010010;
  return format & 0x7fff;
}

function applyFormatBits(matrix) {
  const size = matrix.length;
  const fmt = formatBits(MASK_PATTERN);
  const bit = (n) => ((fmt >> n) & 1) === 1;
  for (let i = 0; i < 6; i += 1) matrix[8][i] = bit(i);
  matrix[8][7] = bit(6);
  matrix[8][8] = bit(7);
  matrix[7][8] = bit(8);
  for (let i = 9; i < 15; i += 1) matrix[14 - i][8] = bit(i);

  for (let i = 0; i < 8; i += 1) matrix[size - 1 - i][8] = bit(i);
  for (let i = 8; i < 15; i += 1) matrix[8][size - 15 + i] = bit(i);
}

function buildMatrix(codewords, version) {
  const { size, remainderBits } = VERSION_TABLE[version];
  const matrix = Array.from({ length: size }, () => Array(size).fill(null));

  addFinder(matrix, 0, 0);
  addFinder(matrix, size - 7, 0);
  addFinder(matrix, 0, size - 7);
  addTiming(matrix);
  const alignmentMap = {
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
  };
  if (version >= 2) {
    const centers = alignmentMap[version];
    centers.forEach((r) => {
      centers.forEach((c) => {
        const inFinder =
          (r <= 8 && c <= 8) ||
          (r <= 8 && c >= size - 8) ||
          (r >= size - 8 && c <= 8);
        if (!inFinder) addAlignment(matrix, r, c);
      });
    });
  }
  // Dark module
  matrix[4 * version + 9][8] = true;
  reserveFormatAreas(matrix);

  // Data bits with mask
  const bits = [];
  codewords.forEach((cw) => {
    for (let i = 7; i >= 0; i -= 1) bits.push((cw >> i) & 1);
  });
  for (let i = 0; i < remainderBits; i += 1) bits.push(0);

  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let i = 0; i < size; i += 1) {
      const row = upward ? size - 1 - i : i;
      for (let j = 0; j < 2; j += 1) {
        const c = col - j;
        if (matrix[row][c] !== null) continue;
        const bit = bitIndex < bits.length ? bits[bitIndex] : 0;
        const masked = ((row + c) % 2 === 0) ? (bit ^ 1) : bit; // mask pattern 0
        matrix[row][c] = masked === 1;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  applyFormatBits(matrix);
  return matrix;
}

export function createQR(text) {
  const version = chooseVersion(utf8Bytes(text).length);
  if (!version) {
    throw new Error('QR: text too long for supported versions (1-4 L)');
  }
  const { ecCodewords } = VERSION_TABLE[version];
  const dataCodewords = buildDataCodewords(text, version);
  const ecWords = reedSolomon(dataCodewords, ecCodewords);
  const codewords = dataCodewords.concat(ecWords);
  const modules = buildMatrix(codewords, version);
  return { version, size: modules.length, modules };
}

export function drawQR(canvas, text, opts = {}) {
  const margin = opts.margin ?? 4;
  const scale = opts.scale ?? 6;
  const { modules, size } = createQR(text);
  const dim = (size + margin * 2) * scale;
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = '#0b0b0f';
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!modules[r][c]) continue;
      ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
    }
  }
  return canvas;
}

export default { createQR, drawQR };
