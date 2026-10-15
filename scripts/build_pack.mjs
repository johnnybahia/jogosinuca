// Gera public/models/table2.glb e cue2.glb a partir de assets_src/pool-table-traditional.zip (mesa e taco do pacote).
//   npm i --no-save sharp @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@0.22
//   node scripts/build_pack.mjs   (precisa do comando `unzip`)
// A mesa do pacote é escalada (sem deformar o desenho além de ~10%) para que a linha do nariz das tabelas caia
// exatamente no campo da física (shared/table.ts). Pano e madeira viram duas malhas: 'cloth' (pano, recolorível) e 'wood'.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, set src(_v) {} }) };
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const root = path.resolve(import.meta.dirname, '..');
const { HL, HW } = await import('../shared/table.ts');
const work = path.join(root, 'assets_src/build/pack');
fs.mkdirSync(work, { recursive: true });
execFileSync('unzip', ['-qo', path.join(root, 'assets_src/pool-table-traditional.zip'), '-d', work]);
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const buf = fs.readFileSync(path.join(work, 'source/pool_table_scene.fbx'));
const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
fbx.updateMatrixWorld(true);

const jpg = (img, size, q = 86) => img.resize(size, size, { fit: 'fill' }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
const tex = (doc, data, name, srgb = true) => doc.createTexture(name).setImage(data).setMimeType('image/jpeg');
const kb = (f) => `${(fs.statSync(f).size / 1024).toFixed(0)} KB`;

function worldGeometry(name, mapFn) {
  const o = fbx.getObjectByName(name);
  const pos = o.geometry.attributes.position;
  const nor = o.geometry.attributes.normal;
  const uv = o.geometry.attributes.uv;
  const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
  const P = new Float32Array(pos.count * 3);
  const N = new Float32Array(pos.count * 3);
  const U = new Float32Array(pos.count * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
    const p = mapFn.pos(v);
    P.set(p, i * 3);
    v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    N.set(mapFn.nor(v), i * 3);
    U[i * 2] = uv.getX(i);
    U[i * 2 + 1] = 1 - uv.getY(i);
  }
  return { P, N, U, count: pos.count };
}

// ---------------- mesa
{
  const NOSE_L = 112.8; // meio comprimento do campo no modelo (cm), medido com raios na altura do centro da bola
  const NOSE_W = 56.81;
  const FELT_Y_M = 76.0; // cm
  const sl = HL / (NOSE_L * 0.01);
  const sw = HW / (NOSE_W * 0.01);
  const map = {
    pos: (v) => [v.z * 0.01 * sl, (v.y - FELT_Y_M) * 0.01, -v.x * 0.01 * sw],
    nor: (n) => [n.z, n.y, -n.x],
  };
  const g = worldGeometry('pooltable_low', map);
  const atlas = sharp(path.join(work, 'textures/pool_table_low_pool_table_mat_BaseColor.png')).removeAlpha();
  const small = await atlas.clone().resize(1024, 1024, { fit: 'fill' }).raw().toBuffer();
  const isCloth = (u, v) => {
    const x = Math.min(1023, Math.max(0, Math.floor(u * 1024)));
    const y = Math.min(1023, Math.max(0, Math.floor(v * 1024)));
    const i = (y * 1024 + x) * 3;
    const r = small[i], gg = small[i + 1], b = small[i + 2];
    return gg > 40 && gg > r * 1.25 && gg > b * 1.15;
  };
  const clothIdx = [];
  const woodIdx = [];
  for (let t = 0; t < g.count; t += 3) {
    const cu = (g.U[t * 2] + g.U[(t + 1) * 2] + g.U[(t + 2) * 2]) / 3;
    const cv = (g.U[t * 2 + 1] + g.U[(t + 1) * 2 + 1] + g.U[(t + 2) * 2 + 1]) / 3;
    (isCloth(cu, cv) ? clothIdx : woodIdx).push(t, t + 1, t + 2);
  }
  console.log('triângulos pano', clothIdx.length / 3, 'madeira', woodIdx.length / 3);

  const doc = new Document();
  const buffer = doc.createBuffer();
  const mk = (idx) => {
    const sub = (arr, n) => {
      const out = new Float32Array(idx.length * n);
      idx.forEach((s, k) => out.set(arr.subarray(s * n, s * n + n), k * n));
      return out;
    };
    return doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(sub(g.P, 3)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(sub(g.N, 3)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(sub(g.U, 2)).setBuffer(buffer));
  };
  // textura de cor (madeira) e versão em cinza do atlas (pano recolorível pelo jogo)
  const colorJpg = await jpg(atlas.clone(), 2048, 84);
  const rough = await jpg(sharp(path.join(work, 'textures/pool_table_low_pool_table_mat_Roughness.png')).removeAlpha(), 1024, 80);
  // brilho do pano do pacote levado ao do pano do jogo (felt.jpg), para as cores do menu ficarem iguais nas duas mesas
  let sum = 0, cnt = 0;
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    if (!isCloth((x + 0.5) / 1024, (y + 0.5) / 1024)) continue;
    const i = (y * 1024 + x) * 3;
    sum += 0.2126 * small[i] + 0.7152 * small[i + 1] + 0.0722 * small[i + 2];
    cnt++;
  }
  const feltMean = (await sharp(path.join(root, 'public/tex/felt.jpg')).greyscale().stats()).channels[0].mean;
  const k = feltMean / (sum / cnt);
  console.log('ganho do pano', k.toFixed(2));
  const gray = await jpg(atlas.clone().greyscale().linear(k, 0), 2048, 84);
  const woodMat = doc
    .createMaterial('wood')
    .setBaseColorTexture(tex(doc, colorJpg, 'atlas'))
    .setMetallicFactor(0)
    .setRoughnessFactor(0.55);
  const clothMat = doc.createMaterial('cloth').setBaseColorTexture(tex(doc, gray, 'atlas_gray')).setMetallicFactor(0).setRoughnessFactor(1);
  void rough;
  const meshW = doc.createMesh('wood').addPrimitive(mk(woodIdx).setMaterial(woodMat));
  const meshC = doc.createMesh('cloth').addPrimitive(mk(clothIdx).setMaterial(clothMat));
  const scene = doc.createScene();
  scene.addChild(doc.createNode('wood').setMesh(meshW)).addChild(doc.createNode('cloth').setMesh(meshC));
  await doc.transform(dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(root, 'public/models/table2.glb');
  await io.write(out, doc);
  console.log('table2.glb', kb(out), 'escala', sl.toFixed(3), sw.toFixed(3));
}

// ---------------- taco (ponta na origem, corpo para -Z, em metros)
{
  const o = fbx.getObjectByName('pool_cue');
  const pos = o.geometry.attributes.position;
  // eixo longo = Z local; ponta = extremo de menor raio
  let zmin = 1e9, zmax = -1e9;
  for (let i = 0; i < pos.count; i++) { zmin = Math.min(zmin, pos.getZ(i)); zmax = Math.max(zmax, pos.getZ(i)); }
  const len = zmax - zmin;
  const rad = { hi: [], lo: [] };
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    if (pos.getZ(i) > zmax - len * 0.1) rad.hi.push(r);
    else if (pos.getZ(i) < zmin + len * 0.1) rad.lo.push(r);
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const tipHigh = avg(rad.hi) < avg(rad.lo);
  const tipVal = tipHigh ? zmax : zmin;
  const S = 0.001; // unidades do mesh * 0,1 (escala do nó) = cm; cm -> m
  const P = new Float32Array(pos.count * 3);
  const N = new Float32Array(pos.count * 3);
  const U = new Float32Array(pos.count * 2);
  const nor = o.geometry.attributes.normal;
  const uv = o.geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * S, y = pos.getY(i) * S, z = (pos.getZ(i) - tipVal) * S;
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    if (tipHigh) { P.set([x, y, z], i * 3); N.set([nx, ny, nz], i * 3); } else { P.set([-x, y, -z], i * 3); N.set([-nx, ny, -nz], i * 3); }
    U[i * 2] = uv.getX(i);
    U[i * 2 + 1] = 1 - uv.getY(i);
  }
  const doc = new Document();
  const buffer = doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(U).setBuffer(buffer));
  const color = await jpg(sharp(path.join(work, 'textures/pool_cue_cue_mat_BaseColor.1001.png')).removeAlpha(), 1024, 86);
  const mat = doc.createMaterial('cue').setBaseColorTexture(tex(doc, color, 'cue')).setMetallicFactor(0).setRoughnessFactor(0.5);
  prim.setMaterial(mat);
  const mesh = doc.createMesh('cue').addPrimitive(prim);
  doc.createScene().addChild(doc.createNode('cue').setMesh(mesh));
  await doc.transform(dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(root, 'public/models/cue2.glb');
  await io.write(out, doc);
  console.log('cue2.glb', kb(out), 'comprimento', (len * S).toFixed(3), 'ponta no', tipHigh ? '+z' : '-z');
}
