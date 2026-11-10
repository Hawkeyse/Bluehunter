// Draws a small line chart as a PNG for chat. Built as an SVG string and
// converted with sharp, which is already a dependency, so no new packages.
const sharp = require('sharp');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FONT = "font-family=\"DejaVu Sans, Helvetica, Arial, sans-serif\"";

// points: [{ label: 'Mon', value: 12 }, ...] oldest first. Returns a PNG Buffer.
async function lineChartPng(points, { title = 'Messages per day' } = {}) {
  const W = 900, H = 460, L = 64, R = 36, T = 84, B = 64;
  const cw = W - L - R, ch = H - T - B;
  const max = Math.max(5, ...points.map((p) => p.value));
  const top = Math.ceil((max * 1.15) / 5) * 5; // round the axis up to a tidy number
  const x = (i) => L + (points.length > 1 ? (i / (points.length - 1)) * cw : cw / 2);
  const y = (v) => T + (1 - v / top) * ch;
  const P = points.map((p, i) => ({ x: x(i), y: y(p.value), ...p }));

  // smooth curve through every point without overshooting between them
  const n = P.length;
  let d = `M${P[0].x},${P[0].y}`;
  if (n === 2) d += ` L${P[1].x},${P[1].y}`;
  else if (n > 2) {
    const dx = [], m = [], t = new Array(n);
    for (let i = 0; i < n - 1; i++) { dx[i] = P[i + 1].x - P[i].x || 1e-6; m[i] = (P[i + 1].y - P[i].y) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += ` C${P[i].x + h},${P[i].y + t[i] * h} ${P[i + 1].x - h},${P[i + 1].y - t[i + 1] * h} ${P[i + 1].x},${P[i + 1].y}`;
    }
  }
  const base = T + ch;
  const area = `${d} L${P[n - 1].x},${base} L${P[0].x},${base} Z`;

  const grid = [0, 1, 2, 3, 4].map((k) => {
    const gy = T + (k / 4) * ch;
    return `<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" stroke="#1f3447" stroke-width="1"/>` +
      `<text x="${L - 12}" y="${gy + 5}" text-anchor="end" fill="#8ea3b8" font-size="15" ${FONT}>${Math.round(top * (1 - k / 4))}</text>`;
  }).join('');
  const dots = P.map((p, i) =>
    `<circle cx="${p.x}" cy="${p.y}" r="6" fill="#0b1620" stroke="#3b9bde" stroke-width="3"/>` +
    `<text x="${p.x}" y="${p.y - 15}" text-anchor="middle" fill="#eef4fa" font-size="16" font-weight="700" ${FONT}>${p.value}</text>` +
    `<text x="${p.x}" y="${H - 28}" text-anchor="middle" fill="#8ea3b8" font-size="15" ${FONT}>${esc(p.label)}</text>`).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b9bde" stop-opacity=".40"/><stop offset="1" stop-color="#3b9bde" stop-opacity="0"/></linearGradient></defs>
<rect width="${W}" height="${H}" rx="18" fill="#0f1c29"/>
<text x="${L}" y="44" fill="#eef4fa" font-size="26" font-weight="700" ${FONT}>${esc(title)}</text>
${grid}
<path d="${area}" fill="url(#g)"/>
<path d="${d}" fill="none" stroke="#3b9bde" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
${dots}
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { lineChartPng };
