/**
 * Converts an image/gif buffer into a WhatsApp-sticker-ready WebP buffer -
 * square canvas, transparent padding, animation preserved for gifs.
 *
 * WhatsApp silently refuses to show animated stickers bigger than ~500 KB
 * (static ones ~100 KB): the send "succeeds" but the sticker never appears.
 * GIPHY gifs are often 1-6 MB, so a single fixed-quality encode produced
 * stickers that were far too big. This tries progressively smaller/lighter
 * encodes until the result fits.
 *
 * `sharp` ships a platform-specific native binary (its actual image codec),
 * so require() is deliberately LAZY: a broken sharp install only breaks
 * sticker conversion when someone triggers it, never the whole bot at startup.
 */
let sharp = null;
let sharpLoadError = null;
function getSharp() {
  if (sharp) return sharp;
  if (sharpLoadError) throw sharpLoadError; // already know it's broken, don't retry every call
  try {
    sharp = require('sharp');
    return sharp;
  } catch (err) {
    sharpLoadError = err;
    throw err;
  }
}

const MAX_ANIMATED_BYTES = 480 * 1024; // WhatsApp limit is ~500 KB
const MAX_STATIC_BYTES = 95 * 1024; // WhatsApp limit is ~100 KB

// Tried in order until the output fits. `pages` caps the frame count (last resort).
const ANIMATED_LADDER = [
  { size: 512, quality: 60 },
  { size: 448, quality: 45 },
  { size: 384, quality: 40 },
  { size: 320, quality: 35 },
  { size: 256, quality: 30 },
  { size: 256, quality: 25, pages: 40 },
  { size: 192, quality: 25, pages: 30 },
];
const STATIC_LADDER = [
  { size: 512, quality: 70 },
  { size: 512, quality: 50 },
  { size: 448, quality: 40 },
  { size: 384, quality: 30 },
];

async function encode(buffer, animated, step) {
  const input = { animated };
  if (animated && step.pages) input.pages = step.pages;
  return getSharp()(buffer, input)
    .resize(step.size, step.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: step.quality, effort: 4 })
    .toBuffer();
}

async function toStickerWebp(buffer, { animated = false } = {}) {
  const ladder = animated ? ANIMATED_LADDER : STATIC_LADDER;
  const limit = animated ? MAX_ANIMATED_BYTES : MAX_STATIC_BYTES;

  let best = null;
  for (const step of ladder) {
    const out = await encode(buffer, animated, step);
    if (!best || out.length < best.length) best = out;
    if (out.length <= limit) return out;
  }
  return best; // smallest we could make; WhatsApp may still reject it
}

module.exports = { toStickerWebp };
