import * as THREE from 'three';
import { BALL_R, CUSHION_D, FELT_Y, HL, HW, POCKETS, POCKET_HOLE_R, RAIL_W } from '../../shared/table';
import type { Assets } from './assets';
import type { QualityProfile } from './quality';

export interface FeltTheme {
  id: string;
  name: string;
  color: number;
  dark: number;
}
export const FELTS: FeltTheme[] = [
  { id: 'verde', name: 'Verde Oficial', color: 0x188a42, dark: 0x0e5a2c },
  { id: 'azul', name: 'Azul Torneio', color: 0x1c6fb5, dark: 0x0f4678 },
  { id: 'vinho', name: 'Vinho Imperial', color: 0xa02335, dark: 0x5c101c },
  { id: 'preto', name: 'Preto Elite', color: 0x34383f, dark: 0x16181c },
];

export interface TableParts {
  group: THREE.Group;
  felt: THREE.Mesh;
  cushions: THREE.Mesh;
  frame: THREE.Mesh;
  lampGroup: THREE.Group;
  spots: THREE.SpotLight[];
  bulbs: THREE.Mesh[];
  floor: THREE.Mesh;
  setFelt(theme: FeltTheme): void;
  setWood(id: string): void;
  /** 'pacote' = mesa do pacote fornecido; qualquer outro = mesa montada por código */
  setTable(id: string): void;
  setProfile(p: QualityProfile): void;
  cones: THREE.Mesh[];
  update(dt: number): void;
}

export const CEILING_Y = 3.4;
const LAMP_SCALE = 1.15;

function feltGeometry(): THREE.BufferGeometry {
  const a = HL + 0.075;
  const b = HW + 0.075;
  const shape = new THREE.Shape();
  shape.moveTo(-a, -b);
  shape.lineTo(a, -b);
  shape.lineTo(a, b);
  shape.lineTo(-a, b);
  shape.closePath();
  for (const p of POCKETS) {
    const h = new THREE.Path();
    const n = 48;
    const r = POCKET_HOLE_R * 0.985;
    for (let i = 0; i <= n; i++) {
      const t = -(i / n) * Math.PI * 2;
      const x = p.x + Math.cos(t) * r;
      const y = p.y + Math.sin(t) * r;
      if (i === 0) h.moveTo(x, y);
      else h.lineTo(x, y);
    }
    shape.holes.push(h);
  }
  const g = new THREE.ShapeGeometry(shape, 24);
  g.rotateX(-Math.PI / 2); // plano XZ, normal para cima
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * 1.65, pos.getZ(i) * 1.65);
  return g;
}

export async function buildTable(assets: Assets, qp: QualityProfile, renderer: THREE.WebGLRenderer): Promise<TableParts> {
  assets.maxAniso = Math.min(qp.anisotropy, renderer.capabilities.getMaxAnisotropy());
  const [tableGltf, table2Gltf, lampGltf, feltTex, feltN, woodTex, woodN, woodMc, woodMn, marC, marN, marR] = await Promise.all([
    assets.gltf('models/table.glb'),
    assets.gltf('models/table2.glb'),
    assets.gltf('models/lamp.glb'),
    assets.texture('tex/felt.jpg', { repeat: true }),
    assets.texture('tex/felt_n.jpg', { repeat: true, srgb: false }),
    assets.texture('tex/wood.jpg', { repeat: true }),
    assets.texture('tex/wood_n.jpg', { repeat: true, srgb: false }),
    assets.texture('tex/wood_m.jpg', { repeat: true }),
    assets.texture('tex/wood_m_n.jpg', { repeat: true, srgb: false }),
    assets.texture(qp.hiTex ? 'tex/marble_c.jpg' : 'tex/marble_c_s.jpg', { repeat: true }),
    assets.texture('tex/marble_n.jpg', { repeat: true, srgb: false }),
    assets.texture('tex/marble_r.jpg', { repeat: true, srgb: false }),
  ]);

  const group = new THREE.Group();
  group.position.y = FELT_Y;

  // ---------- pano
  const feltMat = new THREE.MeshPhysicalMaterial({ color: FELTS[0]!.color, map: feltTex, normalMap: feltN, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1, metalness: 0, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x3fbf70) });
  const felt = new THREE.Mesh(feltGeometry(), feltMat);
  felt.receiveShadow = true;
  group.add(felt);

  // ---------- madeira, tabelas e forro das caçapas (table.glb)
  woodTex.repeat.set(0.5, 0.5);
  woodN.repeat.set(0.5, 0.5);
  const woodMat = new THREE.MeshPhysicalMaterial({ color: 0x9b8878, map: woodTex, normalMap: woodN, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3 });
  const clothTex = feltTex.clone();
  clothTex.repeat.set(0.5, 0.5);
  clothTex.needsUpdate = true;
  const clothN = feltN.clone();
  clothN.repeat.set(0.5, 0.5);
  clothN.needsUpdate = true;
  const clothMat = new THREE.MeshPhysicalMaterial({ color: FELTS[0]!.dark, map: clothTex, normalMap: clothN, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x3fbf70) });
  const pocketMat = new THREE.MeshStandardMaterial({ color: 0x070707, roughness: 0.85, side: THREE.DoubleSide });
  let frame!: THREE.Mesh;
  let cushions!: THREE.Mesh;
  tableGltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.name === 'frame') {
      m.material = woodMat;
      m.castShadow = true;
      m.receiveShadow = true;
      frame = m;
    } else if (m.name === 'cushion') {
      m.material = clothMat;
      m.castShadow = true;
      m.receiveShadow = true;
      cushions = m;
    } else if (m.name === 'pocket') {
      m.material = pocketMat;
    }
  });
  group.add(tableGltf.scene);

  // ---------- losangos de madrepérola
  const pearl = new THREE.MeshPhysicalMaterial({ color: 0xf5f0e4, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
  const dg = new THREE.CylinderGeometry(0.0075, 0.0075, 0.0016, 20);
  const addDiamond = (x: number, z: number): void => {
    const d = new THREE.Mesh(dg, pearl);
    d.position.set(x, 0.0408, z);
    group.add(d);
  };
  const railMid = CUSHION_D + RAIL_W * 0.52;
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) for (const k of [1, 2, 3]) addDiamond(sx * HL * (k / 4) * 1.0, sz * (HW + railMid));
  for (const sx of [-1, 1]) for (const k of [-1, 0, 1]) addDiamond(sx * (HL + railMid), k * HW * 0.5);

  // ---------- aros de couro nas caçapas (só a metade de fora do campo)
  const leather = new THREE.MeshStandardMaterial({ color: 0x2b1810, roughness: 0.55, metalness: 0.05 });
  for (const p of POCKETS) {
    const arc = Math.PI * 1.1;
    const g = new THREE.TorusGeometry(POCKET_HOLE_R + 0.003, 0.0052, 10, 40, arc);
    const t = new THREE.Mesh(g, leather);
    t.rotation.z = Math.atan2(p.ny, p.nx) - arc / 2;
    t.castShadow = true;
    const holder = new THREE.Group();
    holder.add(t);
    holder.rotation.x = -Math.PI / 2;
    holder.position.set(p.x, 0.0408, -p.y);
    group.add(holder);
  }

  // ---------- mesa do pacote (alternativa): pano recolorível + madeira da própria textura
  const tableA = [...group.children];
  const groupB = new THREE.Group();
  const clothB = new THREE.MeshPhysicalMaterial({ color: FELTS[0]!.color, roughness: 1, metalness: 0, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x3fbf70) });
  table2Gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    m.castShadow = true;
    m.receiveShadow = true;
    if (m.name === 'cloth') {
      clothB.map = src.map;
      m.material = clothB;
    } else {
      m.material = new THREE.MeshPhysicalMaterial({ map: src.map, roughness: 0.5, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.35 });
    }
  });
  groupB.add(table2Gltf.scene);
  groupB.visible = false;
  group.add(groupB);
  const setTable = (id: string): void => {
    const b = id === 'pacote';
    for (const c of tableA) c.visible = !b;
    groupB.visible = b;
  };

  // ---------- chão de mármore, paredes e teto
  marC.repeat.set(5, 5);
  marN.repeat.set(5, 5);
  marR.repeat.set(5, 5);
  const floorMat = new THREE.MeshPhysicalMaterial({ map: marC, normalMap: marN, roughnessMap: marR, roughness: 0.65, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2, color: 0x8c857d });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;

  const roomW = 3.6;
  const roomD = 2.9;
  const wallTex = makeWallTexture();
  wallTex.repeat.set(3, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, metalness: 0, color: 0xffffff, emissive: 0xffffff, emissiveMap: wallTex, emissiveIntensity: 0.22 });
  const wallH = CEILING_Y;
  const mkWall = (w: number, x: number, z: number, ry: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, wallH), wallMat);
    m.position.set(x, wallH / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    return m;
  };
  const room = new THREE.Group();
  room.add(mkWall(roomW * 2, 0, -roomD, 0), mkWall(roomW * 2, 0, roomD, Math.PI), mkWall(roomD * 2, -roomW, 0, Math.PI / 2), mkWall(roomD * 2, roomW, 0, -Math.PI / 2));
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(roomW * 2, roomD * 2), new THREE.MeshStandardMaterial({ color: 0x120d0b, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = wallH;
  room.add(ceil);
  // rodapé
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1a0f0a, roughness: 0.5 });
  const bb = (w: number, x: number, z: number, ry: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 0.03), baseMat);
    m.position.set(x, 0.07, z);
    m.rotation.y = ry;
    room.add(m);
  };
  bb(roomW * 2, 0, -roomD + 0.015, 0);
  bb(roomW * 2, 0, roomD - 0.015, 0);
  bb(roomD * 2, -roomW + 0.015, 0, Math.PI / 2);
  bb(roomD * 2, roomW - 0.015, 0, Math.PI / 2);

  const outer = new THREE.Group();
  outer.add(floor, room, group);

  // ---------- luminária (modelo) + holofotes
  const lampGroup = new THREE.Group();
  lampGroup.position.y = CEILING_Y;
  lampGroup.scale.set(LAMP_SCALE * 1.4, LAMP_SCALE, LAMP_SCALE * 1.35);
  lampGroup.add(lampGltf.scene);
  const bulbs: THREE.Mesh[] = [];
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1cf, toneMapped: false });
  lampGltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (/^bulb/.test(m.name)) {
      m.material = bulbMat;
      bulbs.push(m);
    } else {
      m.castShadow = false;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.envMapIntensity = 1;
      mat.depthWrite = true;
    }
  });
  lampGroup.updateMatrixWorld(true);
  const spots: THREE.SpotLight[] = [];
  const bulbPos = bulbs.map((b) => new THREE.Box3().setFromObject(b).getCenter(new THREE.Vector3())).sort((a, b) => a.x - b.x);
  for (const p of bulbPos) {
    const s = new THREE.SpotLight(0xfff0d8, 2.6, 0, 0.98, 0.9, 2);
    s.position.set(p.x, p.y - 0.12, p.z);
    s.target.position.set(p.x * 0.9, FELT_Y, p.z);
    s.shadow.mapSize.set(qp.shadowMap, qp.shadowMap);
    s.shadow.camera.near = 0.35;
    s.shadow.camera.far = 2.6;
    s.shadow.bias = -0.00035;
    s.shadow.normalBias = 0.012;
    s.shadow.radius = 4;
    s.shadow.blurSamples = 12;
    outer.add(s, s.target);
    spots.push(s);
  }
  outer.add(lampGroup);

  const cones: THREE.Mesh[] = [];

  // brilho dos abajures (sprite aditivo)
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,240,210,1)');
    gr.addColorStop(0.25, 'rgba(255,220,160,0.45)');
    gr.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5, toneMapped: false });
  const glows: THREE.Sprite[] = [];
  for (const p of bulbPos) {
    const sp = new THREE.Sprite(glowMat);
    sp.position.set(p.x, p.y - 0.05, p.z);
    sp.scale.setScalar(0.3);
    outer.add(sp);
    glows.push(sp);
  }
  const update = (_dt: number): void => {};

  const setProfile = (p: QualityProfile): void => {
    glows.forEach((g) => (g.visible = p.bloom));
    spots.forEach((s, i) => {
      const on = i < p.shadowLights || (p.shadowLights === 1 && i === 1);
      s.castShadow = p.shadowLights > 0 && (p.shadowLights >= 3 || i === 1) && on;
      if (s.shadow.mapSize.x !== p.shadowMap) {
        s.shadow.mapSize.set(p.shadowMap, p.shadowMap);
        s.shadow.map?.dispose();
        s.shadow.map = null;
      }
    });
  };

  const setFelt = (theme: FeltTheme): void => {
    feltMat.color.setHex(theme.color);
    clothB.color.setHex(theme.color);
    clothMat.color.setHex(theme.dark === 0 ? theme.color : theme.color).multiplyScalar(0.72);
    const sh = new THREE.Color(theme.color).lerp(new THREE.Color(0xffffff), 0.35);
    feltMat.sheenColor.copy(sh);
    clothMat.sheenColor.copy(sh);
  };
  woodMc.repeat.set(0.5, 0.5);
  woodMn.repeat.set(0.5, 0.5);
  const setWood = (id: string): void => {
    const m = id === 'mogno';
    woodMat.map = m ? woodMc : woodTex;
    woodMat.normalMap = m ? woodMn : woodN;
    woodMat.color.setHex(m ? 0xe2d2c8 : 0x9b8878);
    woodMat.roughness = m ? 0.36 : 0.42;
    woodMat.needsUpdate = true;
  };
  setFelt(FELTS[0]!);
  setProfile(qp);

  return { group: outer, felt, cushions, frame, lampGroup, spots, bulbs, floor, setFelt, setWood, setTable, setProfile, cones, update };
}

/** Papel de parede escuro com lambri de madeira na parte de baixo (feito em canvas, sem arquivo). */
function makeWallTexture(): THREE.CanvasTexture {
  const w = 1024;
  const h = 1024;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  // parte alta: reboco vinho escuro com ruído
  g.fillStyle = '#2b1517';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${(Math.random() * 40) | 0},${(Math.random() * 20) | 0},${(Math.random() * 20) | 0},${Math.random() * 0.12})`;
    g.fillRect(Math.random() * w, Math.random() * h * 0.62, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  // lambri (35% inferior)
  const split = Math.floor(h * 0.64);
  g.fillStyle = '#1a0e09';
  g.fillRect(0, split, w, h - split);
  for (let x = 0; x < w; x += 128) {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x, split, 3, h - split);
    g.fillStyle = 'rgba(255,200,140,0.05)';
    g.fillRect(x + 3, split, 2, h - split);
    // moldura do painel
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 3;
    g.strokeRect(x + 16, split + 28, 96, h - split - 56);
    g.strokeStyle = 'rgba(255,190,120,0.07)';
    g.strokeRect(x + 19, split + 31, 90, h - split - 62);
  }
  // friso
  g.fillStyle = '#0f0805';
  g.fillRect(0, split - 8, w, 14);
  g.fillStyle = 'rgba(255,190,120,0.12)';
  g.fillRect(0, split - 8, w, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export const BALL_Y = FELT_Y + BALL_R;
