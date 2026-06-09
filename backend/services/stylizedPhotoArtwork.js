import axios from "axios";
import sharp from "sharp";

const ARTWORK_SIZE = 1200;
const TITLE_PADDING_X = 72;

const PHOTO_ARTWORK_PALETTES = [
  {
    dark: { r: 20, g: 48, b: 32 },
    light: { r: 118, g: 176, b: 132 },
  },
  {
    dark: { r: 48, g: 36, b: 12 },
    light: { r: 196, g: 164, b: 88 },
  },
  {
    dark: { r: 36, g: 20, b: 52 },
    light: { r: 148, g: 108, b: 196 },
  },
  {
    dark: { r: 14, g: 28, b: 52 },
    light: { r: 92, g: 148, b: 196 },
  },
  {
    dark: { r: 52, g: 18, b: 28 },
    light: { r: 196, g: 108, b: 128 },
  },
  {
    dark: { r: 40, g: 28, b: 18 },
    light: { r: 176, g: 148, b: 118 },
  },
];

const hashString = (value) => {
  let hash = 0;
  const input = String(value || "");
  for (let i = 0; i < input.length; i += 1) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash);
};

const escapeXml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const pickPalette = (signature) =>
  PHOTO_ARTWORK_PALETTES[
    hashString(signature) % PHOTO_ARTWORK_PALETTES.length
  ];

const buildCoverTitleLines = (title) => {
  const words = String(title || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const cleaned = [];
  for (const word of words) {
    const previous = cleaned[cleaned.length - 1];
    if (previous && previous.toLowerCase() === word.toLowerCase()) continue;
    cleaned.push(word);
  }
  return cleaned.length > 0 ? cleaned : ["Untitled"];
};

const estimateTextWidth = (line, fontSize) =>
  String(line || "").length * fontSize * 0.56;

const renderArtworkTitleOverlay = async (titleLines) => {
  const maxWidth = ARTWORK_SIZE - TITLE_PADDING_X * 2;
  const maxHeight = ARTWORK_SIZE - 144;
  let fontSize = 132;

  while (fontSize > 28) {
    const lineHeight = fontSize * 1.05;
    const totalHeight = titleLines.length * lineHeight;
    const widestLine = Math.max(
      ...titleLines.map((line) => estimateTextWidth(line, fontSize)),
      0,
    );
    if (totalHeight <= maxHeight && widestLine <= maxWidth) break;
    fontSize -= 2;
  }

  const lineHeight = fontSize * 1.05;
  const totalHeight = titleLines.length * lineHeight;
  const startY = (ARTWORK_SIZE - totalHeight) / 2 + fontSize * 0.82;
  const titleMarkup = titleLines
    .map(
      (line, index) =>
        `<tspan x="${TITLE_PADDING_X}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("");

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${ARTWORK_SIZE}" height="${ARTWORK_SIZE}" viewBox="0 0 ${ARTWORK_SIZE} ${ARTWORK_SIZE}">
  <text
    x="${TITLE_PADDING_X}"
    y="${startY}"
    font-family="Arial Black, Helvetica Neue, Arial, sans-serif"
    font-size="${fontSize}"
    font-weight="900"
    fill="#ffffff"
  >${titleMarkup}</text>
</svg>`.trim();

  return sharp(Buffer.from(svg)).png().toBuffer();
};

const mapToneBufferToPalette = (toneMapRaw, palette) => {
  const pixelCount = ARTWORK_SIZE * ARTWORK_SIZE;
  const mapped = Buffer.alloc(pixelCount * 3);
  const { dark, light } = palette;

  for (let index = 0; index < pixelCount; index += 1) {
    const luminance = toneMapRaw[index] / 255;
    const mappedLuminance = 0.05 + luminance ** 1.38 * 0.32;
    const offset = index * 3;
    mapped[offset] = Math.round(dark.r + (light.r - dark.r) * mappedLuminance);
    mapped[offset + 1] = Math.round(
      dark.g + (light.g - dark.g) * mappedLuminance,
    );
    mapped[offset + 2] = Math.round(
      dark.b + (light.b - dark.b) * mappedLuminance,
    );
  }

  return mapped;
};

export async function fetchImageBuffer(imageUrl) {
  const response = await axios.get(String(imageUrl || "").trim(), {
    responseType: "arraybuffer",
    timeout: 20000,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 400,
  });
  return Buffer.from(response.data);
}

export async function renderStylizedPhotoArtwork({
  imageBuffer,
  title,
  signature,
}) {
  const base = sharp(imageBuffer, { animated: false })
    .resize(ARTWORK_SIZE, ARTWORK_SIZE, { fit: "cover", position: "attention" })
    .ensureAlpha();

  const toneMapRaw = await base
    .clone()
    .grayscale()
    .normalize()
    .linear(1.5, -36)
    .gamma(1.12)
    .raw()
    .toBuffer();

  const palette = pickPalette(signature);
  const mappedRgb = mapToneBufferToPalette(toneMapRaw, palette);
  const mappedImage = await sharp(mappedRgb, {
    raw: { width: ARTWORK_SIZE, height: ARTWORK_SIZE, channels: 3 },
  })
    .png()
    .toBuffer();

  const detailLayer = await base
    .clone()
    .grayscale()
    .normalize()
    .linear(1.18, -12)
    .sharpen({ sigma: 1, m1: 1.2, m2: 2, x1: 2, y2: 10, y3: 16 })
    .png()
    .toBuffer();

  const darkWash = await sharp({
    create: {
      width: ARTWORK_SIZE,
      height: ARTWORK_SIZE,
      channels: 4,
      background: { r: 20, g: 12, b: 18, alpha: 0.18 },
    },
  })
    .png()
    .toBuffer();

  const titleOverlay = await renderArtworkTitleOverlay(
    buildCoverTitleLines(title),
  );

  return sharp({
    create: {
      width: ARTWORK_SIZE,
      height: ARTWORK_SIZE,
      channels: 4,
      background: "#000000",
    },
  })
    .composite([
      { input: mappedImage, blend: "over" },
      { input: detailLayer, blend: "overlay" },
      { input: darkWash, blend: "multiply" },
      { input: titleOverlay, blend: "over" },
    ])
    .linear(0.96, -10)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}
