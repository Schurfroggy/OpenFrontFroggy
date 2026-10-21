export const FOG_CLOUD_TEXTURE_SIZE = 256;

/** Wraparound box blur; three horizontal/vertical pairs approximate a Gaussian. */
function blur(
  source: Float32Array,
  target: Float32Array,
  size: number,
  radius: number,
  vertical: boolean,
): void {
  const diameter = radius * 2 + 1;
  for (let line = 0; line < size; line++) {
    const index = (position: number) =>
      vertical
        ? ((position + size) % size) * size + line
        : line * size + ((position + size) % size);
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset++)
      sum += source[index(offset)];
    for (let position = 0; position < size; position++) {
      target[index(position)] = sum / diameter;
      sum +=
        source[index(position + radius + 1)] - source[index(position - radius)];
    }
  }
}

/** Seamless RG cloud fields from blurred white noise; no coarse square lattice. */
export function createFogCloudNoise(): Uint8Array {
  const size = FOG_CLOUD_TEXTURE_SIZE;
  const count = size * size;
  const pixels = new Uint8Array(count * 2);
  let seed = 0x9e3779b9;
  for (let channel = 0; channel < 2; channel++) {
    const white = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      white[i] = (seed >>> 0) / 0xffffffff;
    }
    const clouds = new Float32Array(count);
    for (const [radius, weight] of [
      [12, 0.6],
      [5, 0.28],
      [2, 0.12],
    ]) {
      let field = white.slice();
      let scratch = new Float32Array(count);
      for (let pass = 0; pass < 3; pass++) {
        blur(field, scratch, size, radius, false);
        [field, scratch] = [scratch, field];
        blur(field, scratch, size, radius, true);
        [field, scratch] = [scratch, field];
      }
      let mean = 0;
      for (const value of field) mean += value / count;
      let variance = 0;
      for (const value of field) variance += (value - mean) ** 2 / count;
      const gain = 0.18 / Math.max(Math.sqrt(variance), 0.00001);
      for (let i = 0; i < count; i++)
        clouds[i] += (0.5 + (field[i] - mean) * gain) * weight;
    }
    for (let i = 0; i < count; i++) {
      pixels[i * 2 + channel] = Math.round(
        Math.max(0, Math.min(1, clouds[i])) * 255,
      );
    }
  }
  return pixels;
}
