// Gera os ícones do app (public/icons) e o favicon a partir de um SVG.  npm i --no-save sharp && node scripts/make_icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const out = path.resolve(import.meta.dirname, '../public/icons');
fs.mkdirSync(out, { recursive: true });
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs>
<radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#1f9a4d"/><stop offset="1" stop-color="#0a4a24"/></radialGradient>
<radialGradient id="ball" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#555a66"/><stop offset="0.35" stop-color="#15171c"/><stop offset="1" stop-color="#050506"/></radialGradient>
<radialGradient id="hl" cx="32%" cy="26%" r="30%"><stop offset="0" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="512" height="512" rx="${pad ? 0 : 110}" fill="url(#bg)"/>
<ellipse cx="270" cy="${pad ? 370 : 392}" rx="150" ry="26" fill="#000" opacity="0.35"/>
<g transform="translate(256 ${pad ? 236 : 246}) scale(${pad ? 0.74 : 1})">
<circle r="168" fill="url(#ball)"/>
<circle r="76" fill="#f7f3ea"/>
<text x="0" y="40" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="112" fill="#111">8</text>
<circle r="168" fill="url(#hl)"/>
</g>
</svg>`;
for (const [name, size, pad] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true]]) {
  await sharp(Buffer.from(svg(pad))).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(out, name));
}
console.log('ícones ok');
