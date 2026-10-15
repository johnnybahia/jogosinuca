// Gera public/models e public/tex a partir dos arquivos originais em assets_src/ (só precisa rodar de novo ao trocar um modelo ou textura).
//   npm i --no-save sharp @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@0.22
//   node scripts/build_assets.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, meshopt, prune, quantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'assets_src');
const build = path.join(src, 'build');
const pub = path.join(root, 'public');
fs.mkdirSync(build, { recursive: true });
fs.mkdirSync(path.join(pub, 'models'), { recursive: true });
fs.mkdirSync(path.join(pub, 'tex/balls'), { recursive: true });

const unzip = (zip, dir) => {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) return;
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('unzip', ['-q', '-o', path.join(src, zip), '-d', dir]);
};
unzip('pool-table-animation.zip', path.join(build, 'pool'));
unzip('Marble014_4K-JPG.zip', path.join(build, 'marble'));
const poolTex = path.join(build, 'pool/textures');
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';

// ---------- bolas: o mapa do arquivo tem um número só, no centro; copia o disco para o lado oposto (duas faces numeradas)
async function ball(n) {
  const name = n === 0 ? 'BallCue.jpeg' : n === 15 ? 'Ball 15.jpeg' : `Ball${n}.jpeg`;
  const W = 1296;
  const H = 648;
  const base = await sharp(path.join(poolTex, name)).resize(W, H, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = base;
  const ch = info.channels;
  if (n !== 0) {
    const out = Buffer.from(data);
    const cx = W / 2;
    const cy = H / 2;
    const rad = Math.round(H * 0.125) + 8; // disco do número (~36 px no original de 324 de altura) + folga
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > rad) continue;
        const sx = Math.round(cx + dx);
        const sy = Math.round(cy + dy);
        // destino: u = 0 (e 1), ou seja x = 0 com volta
        const tx = (((dx % W) + W) % W) | 0;
        const ty = sy;
        const w = d > rad - 3 ? (rad - d) / 3 : 1; // borda suave
        for (let c = 0; c < ch; c++) {
          const s = data[(sy * W + sx) * ch + c];
          const o = out[(ty * W + tx) * ch + c];
          out[(ty * W + tx) * ch + c] = Math.round(o + (s - o) * w);
        }
      }
    }
    await sharp(out, { raw: { width: W, height: H, channels: ch } }).jpeg({ quality: 90, mozjpeg: true }).toFile(path.join(pub, `tex/balls/ball_${String(n).padStart(2, '0')}.jpg`));
  } else {
    await sharp(data, { raw: { width: W, height: H, channels: ch } }).jpeg({ quality: 90, mozjpeg: true }).toFile(path.join(pub, 'tex/balls/ball_00.jpg'));
  }
}
for (let n = 0; n <= 15; n++) await ball(n);
console.log('bolas ok');

// ---------- pano (luminância sem a variação de grande escala, o tema pinta por cima), madeira e mármore
// Os mapas viram ladrilhos 2x2 espelhados (sem emenda); no mapa de normais o espelho inverte o canal do eixo espelhado.
async function mirrorTile(input, { normal = false, quality = 88 } = {}) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const out = Buffer.alloc(w * 2 * h * 2 * c);
  for (let y = 0; y < h * 2; y++) {
    const sy = y < h ? y : 2 * h - 1 - y;
    const fy = y >= h;
    for (let x = 0; x < w * 2; x++) {
      const sx = x < w ? x : 2 * w - 1 - x;
      const fx = x >= w;
      for (let k = 0; k < c; k++) {
        let v = data[(sy * w + sx) * c + k];
        if (normal && ((k === 0 && fx) || (k === 1 && fy))) v = 255 - v;
        out[(y * w * 2 + x) * c + k] = v;
      }
    }
  }
  return sharp(out, { raw: { width: w * 2, height: h * 2, channels: c } }).jpeg({ quality, mozjpeg: true });
}
{
  const pad = sharp(path.join(poolTex, 'Pad.jpeg')).resize(900, 600, { kernel: 'lanczos3' }).greyscale();
  const base = await pad.clone().raw().toBuffer({ resolveWithObject: true });
  const blur = await sharp(base.data, { raw: { width: 900, height: 600, channels: 1 } }).blur(40).raw().toBuffer();
  const hp = Buffer.alloc(base.data.length);
  let sum = 0;
  for (let i = 0; i < hp.length; i++) {
    const v = base.data[i] - blur[i];
    hp[i] = Math.max(0, Math.min(255, 190 + v * 1.5));
    sum += hp[i];
  }
  await (await mirrorTile(await sharp(hp, { raw: { width: 900, height: 600, channels: 1 } }).png().toBuffer())).toFile(path.join(pub, 'tex/felt.jpg'));
  await (await mirrorTile(await sharp(path.join(poolTex, 'Pad.jpg_specular.jpeg')).resize(900, 600, { kernel: 'lanczos3' }).png().toBuffer(), { normal: true, quality: 90 })).toFile(path.join(pub, 'tex/felt_n.jpg'));
  await (await mirrorTile(await sharp(path.join(poolTex, 'Wood.png')).resize(1024, 768, { kernel: 'lanczos3' }).png().toBuffer(), { quality: 84 })).toFile(path.join(pub, 'tex/wood.jpg'));
  await (await mirrorTile(await sharp(path.join(poolTex, 'Wood.png_specular.jpeg')).resize(1024, 768, { kernel: 'lanczos3' }).png().toBuffer(), { normal: true, quality: 86 })).toFile(path.join(pub, 'tex/wood_n.jpg'));
  console.log('pano e madeira ok (média do pano', (sum / hp.length).toFixed(0), ')');
}
const mb = path.join(build, 'marble');
await sharp(path.join(mb, 'Marble014_4K_Color.jpg')).resize(2048, 2048).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(pub, 'tex/marble_c.jpg'));
await sharp(path.join(mb, 'Marble014_4K_NormalGL.jpg')).resize(1024, 1024).jpeg({ quality: 86, mozjpeg: true }).toFile(path.join(pub, 'tex/marble_n.jpg'));
await sharp(path.join(mb, 'Marble014_4K_Roughness.jpg')).resize(1024, 1024).greyscale().jpeg({ quality: 86, mozjpeg: true }).toFile(path.join(pub, 'tex/marble_r.jpg'));
console.log('texturas ok');

// ---------- GLBs (taco e luminária)
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

async function shrink(tex, size, q, keepAlpha = false) {
  const img = tex.getImage();
  if (!img) return;
  const meta = await sharp(img).metadata();
  let s = sharp(img).resize(size, size, { fit: 'inside', kernel: 'lanczos3' });
  if (keepAlpha && meta.hasAlpha) {
    tex.setImage(new Uint8Array(await s.png({ compressionLevel: 9, effort: 10 }).toBuffer())).setMimeType('image/png');
    return;
  }
  s = s.removeAlpha();
  tex.setImage(new Uint8Array(await s.jpeg({ quality: q, mozjpeg: true }).toBuffer())).setMimeType('image/jpeg');
}

function bakeWorld(doc) {
  // aplica a matriz de cada nó nos vértices (posições e normais) e zera o nó
  const root = doc.getRoot();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const nm = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
    // normaliza as colunas para as normais
    for (let c = 0; c < 3; c++) {
      const l = Math.hypot(nm[c * 3], nm[c * 3 + 1], nm[c * 3 + 2]);
      nm[c * 3] /= l;
      nm[c * 3 + 1] /= l;
      nm[c * 3 + 2] /= l;
    }
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const nor = prim.getAttribute('NORMAL');
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        pos.setElement(i, [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
      }
      if (nor) {
        for (let i = 0; i < nor.getCount(); i++) {
          nor.getElement(i, v);
          const x = nm[0] * v[0] + nm[3] * v[1] + nm[6] * v[2];
          const y = nm[1] * v[0] + nm[4] * v[1] + nm[7] * v[2];
          const z = nm[2] * v[0] + nm[5] * v[1] + nm[8] * v[2];
          const l = Math.hypot(x, y, z) || 1;
          nor.setElement(i, [x / l, y / l, z / l]);
        }
      }
    }
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
}

function bounds(prim) {
  const pos = prim.getAttribute('POSITION');
  return { min: pos.getMin([0, 0, 0]), max: pos.getMax([0, 0, 0]) };
}

// taco: eixo +Z, ponta na origem e corpo para -Z. O eixo do modelo é o Z local do mesh; a escala vem da matriz do nó.
{
  const doc = await io.read(path.join(src, 'taco.glb'));
  const node = doc.getRoot().listNodes().find((n) => n.getMesh());
  const wm = node.getWorldMatrix();
  const sc = Math.hypot(wm[0], wm[1], wm[2]);
  const prim = node.getMesh().listPrimitives()[0];
  const pos = prim.getAttribute('POSITION');
  const nor = prim.getAttribute('NORMAL');
  const b = bounds(prim);
  const len = b.max[2] - b.min[2];
  const rad = { hi: [], lo: [] };
  const v = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v);
    const r = Math.hypot(v[0], v[1]);
    if (v[2] > b.max[2] - len * 0.1) rad.hi.push(r);
    else if (v[2] < b.min[2] + len * 0.1) rad.lo.push(r);
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const tipHigh = avg(rad.hi) < avg(rad.lo);
  const tipVal = tipHigh ? b.max[2] : b.min[2];
  const tmp = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v);
    const a = [v[0] * sc, v[1] * sc, (v[2] - tipVal) * sc];
    pos.setElement(i, tipHigh ? a : [-a[0], a[1], -a[2]]);
    nor.getElement(i, tmp);
    pos.getElement(i, v);
    nor.setElement(i, tipHigh ? [tmp[0], tmp[1], tmp[2]] : [-tmp[0], tmp[1], -tmp[2]]);
  }
  node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  // solta os pais (rotações do Sketchfab) mantendo só o nó do mesh na raiz
  const scene = doc.getRoot().listScenes()[0];
  for (const c of scene.listChildren()) scene.removeChild(c);
  scene.addChild(node);
  const mat = prim.getMaterial();
  await shrink(mat.getBaseColorTexture(), 2048, 86);
  await shrink(mat.getNormalTexture(), 1024, 88);
  await shrink(mat.getMetallicRoughnessTexture(), 1024, 88);
  await doc.transform(dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(pub, 'models/cue.glb');
  await io.write(out, doc);
  console.log('cue.glb', kb(out), 'comprimento', (len * sc).toFixed(3), 'ponta no', tipHigh ? '+z' : '-z');
}

// luminária: pendurada a partir de y=0 (corrente no topo), barra no eixo X
{
  const doc = await io.read(path.join(src, 'pool_table_light_-_2048px2.glb'));
  await doc.transform(flatten());
  bakeWorld(doc);
  const nodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
  let i = 0;
  for (const n of nodes) {
    const name = n.getMesh().getName();
    if (/Lightbulb/i.test(name)) n.setName(`bulb${i++}`);
    else n.setName('lamp');
  }
  const mats = doc.getRoot().listMaterials();
  for (const m of mats) {
    const big = /Lightbulb/i.test(m.getName()) ? 128 : 1024;
    await shrink(m.getBaseColorTexture(), big, 84, true);
    await shrink(m.getNormalTexture(), big === 128 ? 64 : 1024, 86);
    await shrink(m.getMetallicRoughnessTexture(), big === 128 ? 64 : 1024, 86);
  }
  await doc.transform(dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(pub, 'models/lamp.glb');
  await io.write(out, doc);
  console.log('lamp.glb', kb(out));
}
console.log('pronto');
