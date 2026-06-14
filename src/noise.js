/**
 * Deterministic 2D value noise with fractal Brownian motion.
 * No external dependencies; used to generate temperature and moisture maps.
 */

const Noise = (function () {
  const PERM_SIZE = 256;

  /**
   * Linear interpolation between a and b by t (0..1).
   */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Smooth step (3t^2 - 2t^3) for value noise interpolation.
   */
  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  /**
   * Deterministic pseudo-random hash from integer coordinates.
   */
  function hash2(x, y, seed) {
    let n = (x * 374761393 + y * 668265263 + seed * 1013904223) | 0;
    n = (n << 13) ^ n;
    n = (n * 5 + 0x6b64) | 0;
    n = ((n >> 16) ^ n) | 0;
    return n;
  }

  /**
   * Returns a deterministic float in [0, 1) for integer lattice point (x, y).
   */
  function latticeValue(x, y, seed) {
    const h = hash2(x, y, seed);
    return ((h >>> 0) % 1000000) / 1000000;
  }

  /**
   * 2D value noise at continuous coordinates. Output is in [0, 1).
   */
  function valueNoise2D(x, y, seed) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const xf = x - x0;
    const yf = y - y0;

    const n00 = latticeValue(x0, y0, seed);
    const n10 = latticeValue(x0 + 1, y0, seed);
    const n01 = latticeValue(x0, y0 + 1, seed);
    const n11 = latticeValue(x0 + 1, y0 + 1, seed);

    const sx = smooth(xf);
    const sy = smooth(yf);

    const nx0 = lerp(n00, n10, sx);
    const nx1 = lerp(n01, n11, sx);
    return lerp(nx0, nx1, sy);
  }

  /**
   * Fractal Brownian motion: sums several octaves of value noise.
   */
  function fbm(x, y, seed, octaves, persistence, lacunarity) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += valueNoise2D(x * frequency, y * frequency, seed + i * 31) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxValue;
  }

  /**
   * Generate a normalized Float32Array of size width * height filled with fbm noise.
   */
  function generateMap(width, height, seed, scale, octaves = 4, persistence = 0.5, lacunarity = 2.0) {
    const map = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = fbm(x / scale, y / scale, seed, octaves, persistence, lacunarity);
        map[y * width + x] = v;
      }
    }
    return map;
  }

  return {
    valueNoise2D,
    fbm,
    generateMap,
  };
})();
