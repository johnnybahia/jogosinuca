// Gera public/models/table.glb: madeira (tampo com os cortes das caçapas, avental e pernas), tabelas (borracha forrada de pano) e
// o forro preto das caçapas. Todas as medidas vêm de shared/table.ts, então o desenho bate com a física.
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@0.22 polygon-clipping
//   node scripts/build_table.mjs   (Node 22.18+)
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import polygonClipping from 'polygon-clipping';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const root = path.resolve(import.meta.dirname, '..');
// precisa de Node 22.18+ (lê o .ts direto)
const C = await import('../shared/table.ts');
const { HL, HW, FELT_Y, CORNER_G, SIDE_G, POCKET_HOLE_R, CUSHION_D, RAIL_W } = C;

const CAP_TOP = 0.04;
const CAP_BOTTOM = -0.012;
const APRON_BOTTOM = -0.16;
const A = HL + CUSHION_D + RAIL_W;
const B = HW + CUSHION_D + RAIL_W;
const CORNER_R = 0.055;

const pockets = [
  [-(HL - 0.004), -(HW - 0.004)],
  [HL - 0.004, -(HW - 0.004)],
  [-(HL - 0.004), HW - 0.004],
  [HL - 0.004, HW - 0.004],
  [0, -(HW + 0.025)],
  [0, HW + 0.025],
];

const circle = (cx, cz, r, n = 64) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cz + Math.sin((i / n) * Math.PI * 2) * r]);
const rectRing = (a, b) => [
  [-a, -b],
  [a, -b],
  [a, b],
  [-a, b],
  [-a, -b],
];
const holeUnion = () => {
  const polys = [[rectRing(HL + CUSHION_D, HW + CUSHION_D)], ...pockets.map(([x, z]) => [circle(x, z, POCKET_HOLE_R)])];
  const u = polygonClipping.union(...polys);
  return u[0][0];
};
const roundedRect = (a, b, r) => {
  const s = new THREE.Shape();
  s.moveTo(-a + r, -b);
  s.lineTo(a - r, -b);
  s.absarc(a - r, -b + r, r, -Math.PI / 2, 0, false);
  s.lineTo(a, b - r);
  s.absarc(a - r, b - r, r, 0, Math.PI / 2, false);
  s.lineTo(-a + r, b);
  s.absarc(-a + r, b - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-a, -b + r);
  s.absarc(-a + r, -b + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
};
const withHole = (shape, ring) => {
  const h = new THREE.Path();
  // buraco em sentido contrário ao do contorno
  const pts = ring.slice(0, -1).reverse();
  h.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) h.lineTo(p[0], p[1]);
  h.closePath();
  shape.holes.push(h);
  return shape;
};

// shape em (x, y) -> plano horizontal: x = x, z = -y, y = altura
const slab = (shape, y0, y1, bevel) => {
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0 - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 16 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + bevel, 0);
  return g.index ? g.toNonIndexed() : g;
};

const ring = holeUnion();
const geoms = [];

// tampo
{
  const shape = withHole(roundedRect(A - 0.004, B - 0.004, CORNER_R), ring);
  geoms.push(slab(shape, CAP_BOTTOM, CAP_TOP, 0.004));
}
// avental (um pouco recuado) com o mesmo buraco
{
  const shape = withHole(roundedRect(A - 0.02, B - 0.02, CORNER_R - 0.01), ring);
  geoms.push(slab(shape, APRON_BOTTOM, CAP_BOTTOM + 0.002, 0));
}
// pernas
const LEG_TOP = APRON_BOTTOM + 0.01;
const LEG_BOTTOM = -FELT_Y + 0.045;
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    const w = 0.12;
    const s = new THREE.Shape();
    const r = 0.025;
    s.moveTo(-w / 2 + r, -w / 2);
    s.lineTo(w / 2 - r, -w / 2);
    s.absarc(w / 2 - r, -w / 2 + r, r, -Math.PI / 2, 0, false);
    s.lineTo(w / 2, w / 2 - r);
    s.absarc(w / 2 - r, w / 2 - r, r, 0, Math.PI / 2, false);
    s.lineTo(-w / 2 + r, w / 2);
    s.absarc(-w / 2 + r, w / 2 - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-w / 2, -w / 2 + r);
    s.absarc(-w / 2 + r, -w / 2 + r, r, Math.PI, Math.PI * 1.5, false);
    const g = slab(s, LEG_BOTTOM, LEG_TOP, 0.003);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = (LEG_TOP - pos.getY(i)) / (LEG_TOP - LEG_BOTTOM);
      const k = 1 - 0.28 * Math.min(1, Math.max(0, t));
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    g.translate(sx * (A - 0.14), 0, sz * (B - 0.14));
    geoms.push(g);
    // pé nivelador
    const foot = new THREE.CylinderGeometry(0.045, 0.052, 0.045, 32).toNonIndexed();
    foot.translate(sx * (A - 0.14), -FELT_Y + 0.0225, sz * (B - 0.14));
    geoms.push(foot);
  }
}
// sapatas sob o tampo (reforço visual entre as pernas)
for (const sz of [-1, 1]) {
  const g = new THREE.BoxGeometry(2 * (A - 0.2), 0.05, 0.05).toNonIndexed();
  g.translate(0, APRON_BOTTOM - 0.02, sz * (B - 0.14));
  geoms.push(g);
}
for (const sx of [-1, 1]) {
  const g = new THREE.BoxGeometry(0.05, 0.05, 2 * (B - 0.2)).toNonIndexed();
  g.translate(sx * (A - 0.14), APRON_BOTTOM - 0.02, 0);
  geoms.push(g);
}

// UV planar da madeira: veio acompanha o comprimento de cada trecho do tampo
function planarUV(g, scale) {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const nx = (nor.getX(i) + nor.getX(i + 1) + nor.getX(i + 2)) / 3;
    const ny = (nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2)) / 3;
    const nz = (nor.getZ(i) + nor.getZ(i + 1) + nor.getZ(i + 2)) / 3;
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k);
      const y = pos.getY(i + k);
      const z = pos.getZ(i + k);
      let u;
      let v;
      if (Math.abs(ny) > 0.6) {
        if (Math.abs(cx) > HL + CUSHION_D && Math.abs(cz) < HW + CUSHION_D) {
          u = z;
          v = x;
        } else {
          u = x;
          v = z;
        }
      } else if (Math.abs(nz) > Math.abs(nx)) {
        u = x;
        v = y;
      } else {
        u = z;
        v = y;
      }
      uv[(i + k) * 2] = u * scale;
      uv[(i + k) * 2 + 1] = v * scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

const frame = mergeGeometries(geoms.map((g) => {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}));
frame.computeVertexNormals();
planarUV(frame, 1.6);

// ---------- tabelas
const PROFILE = [
  [0.014, 0.0],
  [0.0, 0.0335],
  [0.0012, 0.0365],
  [0.005, 0.0385],
  [0.04, 0.0385],
  [0.04, 0.0],
];
const SEGS = [
  [SIDE_G, HW, HL - CORNER_G, HW, 0, -1, 0.5, 1.0],
  [-(HL - CORNER_G), HW, -SIDE_G, HW, 0, -1, 1.0, 0.5],
  [SIDE_G, -HW, HL - CORNER_G, -HW, 0, 1, 0.5, 1.0],
  [-(HL - CORNER_G), -HW, -SIDE_G, -HW, 0, 1, 1.0, 0.5],
  [HL, -(HW - CORNER_G), HL, HW - CORNER_G, -1, 0, 1.0, 1.0],
  [-HL, -(HW - CORNER_G), -HL, HW - CORNER_G, 1, 0, 1.0, 1.0],
];
function cushion([x1, y1, x2, y2, nx, ny, tanS, tanE]) {
  const L = Math.hypot(x2 - x1, y2 - y1);
  const tx = (x2 - x1) / L;
  const ty = (y2 - y1) / L;
  const ox = -nx;
  const oy = -ny;
  const P = (u, d, h) => new THREE.Vector3(x1 + tx * u + ox * d, h, y1 + ty * u + oy * d);
  const ends = PROFILE.map(([d, h]) => ({ s: P(-d * tanS, d, h), e: P(L + d * tanE, d, h) }));
  const tris = [];
  const quad = (a, b, c, d) => tris.push(a, b, c, a, c, d);
  for (let i = 0; i < PROFILE.length; i++) {
    const j = (i + 1) % PROFILE.length;
    quad(ends[i].s, ends[i].e, ends[j].e, ends[j].s);
  }
  const prof2d = PROFILE.map(([d, h]) => new THREE.Vector2(d, h));
  const cap = THREE.ShapeUtils.triangulateShape(prof2d, []);
  for (const [a, b, c] of cap) {
    tris.push(ends[a].s, ends[c].s, ends[b].s);
    tris.push(ends[a].e, ends[b].e, ends[c].e);
  }
  const g = new THREE.BufferGeometry().setFromPoints(tris);
  g.computeVertexNormals();
  // corrige o sentido: a normal do topo tem que apontar para cima
  const n = g.attributes.normal;
  let up = 0;
  for (let i = 0; i < n.count; i++) up += n.getY(i);
  if (up < 0) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      const ax = pos.getX(i + 1);
      const ay = pos.getY(i + 1);
      const az = pos.getZ(i + 1);
      pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      pos.setXYZ(i + 2, ax, ay, az);
    }
    g.computeVertexNormals();
  }
  return g;
}
const cush = mergeGeometries(SEGS.map(cushion));
{
  const pos = cush.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * 4.5;
    uv[i * 2 + 1] = pos.getZ(i) * 4.5 + pos.getY(i) * 4.5;
  }
  cush.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ---------- forro das caçapas
const liners = mergeGeometries(
  pockets.map(([x, z]) => {
    const g = new THREE.CylinderGeometry(POCKET_HOLE_R * 0.98, POCKET_HOLE_R * 0.7, 0.2, 40, 1, true).toNonIndexed();
    g.translate(x, -0.1 - 0.0, z);
    const bottom = new THREE.CircleGeometry(POCKET_HOLE_R * 0.7, 40).toNonIndexed();
    bottom.rotateX(Math.PI / 2);
    bottom.translate(x, -0.2, z);
    return mergeGeometries([g, bottom]);
  }),
);

// ---------- escreve o GLB
const doc = new Document();
const buf = doc.createBuffer();
const scene = doc.createScene('table');
const addMesh = (name, geo, matName, props) => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const mat = doc.createMaterial(matName).setBaseColorFactor(props.color).setRoughnessFactor(props.rough).setMetallicFactor(props.metal);
  if (props.double) mat.setDoubleSided(true);
  const prim = doc.createPrimitive().setMaterial(mat);
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.attributes.position.array)).setBuffer(buf));
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.attributes.normal.array)).setBuffer(buf));
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(g.attributes.uv.array)).setBuffer(buf));
  const mesh = doc.createMesh(name).addPrimitive(prim);
  scene.addChild(doc.createNode(name).setMesh(mesh));
};
addMesh('frame', frame, 'wood', { color: [1, 1, 1, 1], rough: 0.5, metal: 0 });
addMesh('cushion', cush, 'cloth', { color: [0.1, 0.5, 0.2, 1], rough: 0.95, metal: 0 });
addMesh('pocket', liners, 'pocket', { color: [0.02, 0.02, 0.02, 1], rough: 0.8, metal: 0, double: true });

await MeshoptEncoder.ready;
await doc.transform(weld(), dedup(), prune(), quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const out = path.join(root, 'public/models/table.glb');
fs.mkdirSync(path.dirname(out), { recursive: true });
await io.write(out, doc);
console.log('table.glb', (fs.statSync(out).size / 1024).toFixed(0) + ' KB', 'tampo', A.toFixed(3), 'x', B.toFixed(3));
