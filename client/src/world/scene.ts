import * as THREE from 'three';
import { ALLEY, AREAS, areaById, BAR, DIFFICULTIES, CASHIER, COLORS, RESTROOM, DECOR, DOORS, GAME_NAME, OPENINGS, ROOM, STATIONS, type LeaderboardEntry, type LobbyInfo, type ZoneKey } from '@casino/shared';
import { buildOutside } from './outside';
import { buildRooms, restroomTiles } from './rooms';
import { buildToilet } from './pee';
import { TextSprite } from './labels';
import { canvasTexture, flat, glowPlane, glowSprite, matte, SERIF, toon } from './materials';

export interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** Everything inside the casino (and its alley). Put tables and casino staff in here. */
  casino: THREE.Group;
  /** The street outside (shown only when you can see it). */
  street: THREE.Group;
  camera: THREE.PerspectiveCamera;
  /**
   * You are in `zone`, and can see into `seen` through open doorways: show those and hide
   * the rest. `snap` jumps the fog and light straight to the new zone (a teleport); otherwise
   * they ease over as you walk through.
   */
  setZone(zone: ZoneKey, seen?: Iterable<ZoneKey>, snap?: boolean): void;
  readonly zone: ZoneKey;
  /** Who lives where in the apartment building. */
  setLobby(info: LobbyInfo): void;
  /** The two leaves of the exit door. Rotate each by `userData.openSign * angle` to open it. */
  exitDoors: THREE.Object3D[];
  /** The bookcase that hides the back room. Turn it by up to about 1.4 radians to open it. */
  secretDoor: THREE.Object3D;
  setLeaderboard(list: LeaderboardEntry[]): void;
  update(dt: number, time: number): void;
  resize(): void;
}

/** How each level reads on the leaderboard. */
const LEVEL_COLORS: Record<string, string> = { easy: '#7fd18a', normal: '#e0b25a', hard: '#ff6a5a' };

const W = ROOM.halfW;
const D = ROOM.halfD;
const H = ROOM.height;

// The look: an old, dim, expensive room. Dark wood, brass, deep red, and small pools
// of warm lamplight. Everything bright and silly in it is a person.
const WOOD = '#6a3a22';
const WOOD_DARK = '#2b140b';
const BRASS = '#b08a45';
const LAMP = '#ffb766';
/** Height of the floor behind the bar. */
export const BAR_PLATFORM = 0.28;

/** A little repeatable randomness so textures and props look the same every visit. */
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Make a texture once, the first time it is asked for. */
function once(make: () => THREE.Texture) {
  let t: THREE.Texture | null = null;
  return () => (t ??= make());
}

/** Old red brick, for the alley and the back room. */
export const BRICK_TEX = once(() => {
  const t = canvasTexture(256, 256, (c) => {
    const rnd = seeded(77);
    c.fillStyle = '#1f1a1c';
    c.fillRect(0, 0, 256, 256);
    const bw = 64;
    const bh = 26;
    for (let row = 0; row < 256 / bh + 1; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < 256 + bw; x += bw) {
        const r = 70 + rnd() * 30;
        c.fillStyle = `rgb(${r}, ${r * 0.42}, ${r * 0.36})`;
        c.fillRect(x + off + 2, row * bh + 2, bw - 4, bh - 4);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
});

/** Deep green panels with a faint damask pattern, for the card room. */
export const GREEN_TEX = once(() => {
  const t = canvasTexture(256, 512, (c) => {
    c.fillStyle = '#163b2a';
    c.fillRect(0, 0, 256, 512);
    c.fillStyle = 'rgba(120, 190, 140, 0.08)';
    for (let y = 30; y < 512; y += 70) {
      for (let x = 32; x < 256; x += 64) {
        const off = (y / 70) % 2 ? 32 : 0;
        c.beginPath();
        c.ellipse(x + off, y, 14, 24, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.strokeStyle = '#0b2117';
    c.lineWidth = 8;
    c.strokeRect(20, 20, 216, 472);
    c.strokeStyle = 'rgba(200, 170, 90, 0.35)';
    c.lineWidth = 2;
    c.strokeRect(28, 28, 200, 456);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
});

/** Plum velvet with gold stripes, for the dice parlour. */
export const PARLOUR_TEX = once(() => {
  const t = canvasTexture(128, 256, (c) => {
    c.fillStyle = '#2c1438';
    c.fillRect(0, 0, 128, 256);
    c.fillStyle = '#3a1b4a';
    c.fillRect(0, 0, 64, 256);
    c.fillStyle = 'rgba(224, 178, 90, 0.4)';
    c.fillRect(62, 0, 4, 256);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
});

export function createWorld(canvas: HTMLCanvasElement): World {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  // The whole world, and inside it one group per zone. Only the zone you are in is drawn.
  const stage = new THREE.Scene();
  stage.background = new THREE.Color('#0b0705');
  const fog = new THREE.FogExp2('#150b07', 0.018);
  stage.fog = fog;
  /** The casino, and everything in this file. (Named `scene` so the code below reads naturally.) */
  const scene = new THREE.Group();
  scene.name = 'casino';
  stage.add(scene);

  const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 140);
  camera.rotation.order = 'YXZ';
  stage.add(camera); // so things hung off it (your arms) are drawn

  const brass = matte(BRASS, { emissive: '#3a2a10' });
  const woodDark = matte(WOOD_DARK);
  const bulb = flat('#fff0c8');

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

  // ---- light ---------------------------------------------------------------------
  // Very little fill, so the corners fall away into the dark.
  const sky = new THREE.HemisphereLight('#ffc493', '#2a140b', 0.75);
  stage.add(sky);
  const flicker: { light: THREE.PointLight; base: number; phase: number }[] = [];

  // ---- floor: dark patterned carpet, with rugs on top -----------------------------
  const carpet = canvasTexture(256, 256, (c) => {
    c.fillStyle = '#2d0f11';
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = '#47181a';
    c.lineWidth = 9;
    const nodes = [[128, 128], [0, 0], [256, 0], [0, 256], [256, 256]];
    for (const [cx, cy] of nodes) {
      c.beginPath();
      c.moveTo(cx, cy - 96);
      c.lineTo(cx + 96, cy);
      c.lineTo(cx, cy + 96);
      c.lineTo(cx - 96, cy);
      c.closePath();
      c.stroke();
    }
    c.fillStyle = '#8a6524';
    for (const [cx, cy] of nodes) {
      c.beginPath();
      c.moveTo(cx, cy - 13);
      c.lineTo(cx + 13, cy);
      c.lineTo(cx, cy + 13);
      c.lineTo(cx - 13, cy);
      c.fill();
    }
    c.fillStyle = '#1f3d30';
    for (const [cx, cy] of [[128, 0], [0, 128], [256, 128], [128, 256]]) {
      c.beginPath();
      c.arc(cx, cy, 7, 0, Math.PI * 2);
      c.fill();
    }
  });
  carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
  carpet.repeat.set(W / 0.9, D / 0.9);
  const floor = mesh(new THREE.PlaneGeometry(W * 2, D * 2), matte('#ffffff', { map: carpet }), 0, 0, 0);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;

  const rugTex = canvasTexture(512, 384, (c) => {
    c.fillStyle = '#17121c';
    c.fillRect(0, 0, 512, 384);
    c.fillStyle = '#7a1c1e';
    c.fillRect(22, 22, 468, 340);
    c.strokeStyle = '#b08a45';
    c.lineWidth = 4;
    c.strokeRect(22, 22, 468, 340);
    c.fillStyle = '#d9c39a';
    const diamond = (x: number, y: number, r: number) => {
      c.beginPath();
      c.moveTo(x, y - r);
      c.lineTo(x + r, y);
      c.lineTo(x, y + r);
      c.lineTo(x - r, y);
      c.fill();
    };
    for (let x = 48; x < 480; x += 32) {
      diamond(x, 42, 7);
      diamond(x, 342, 7);
    }
    for (let y = 74; y < 330; y += 32) {
      diamond(42, y, 7);
      diamond(470, y, 7);
    }
    c.fillStyle = '#4c1014';
    c.fillRect(64, 64, 384, 256);
    c.strokeStyle = '#b08a45';
    c.strokeRect(64, 64, 384, 256);
    const medallion = (x: number, y: number, s: number) => {
      c.fillStyle = '#17121c';
      diamond(x, y, 70 * s);
      c.fillStyle = '#b08a45';
      diamond(x, y, 54 * s);
      c.fillStyle = '#7a1c1e';
      diamond(x, y, 42 * s);
      c.fillStyle = '#d9c39a';
      diamond(x, y, 18 * s);
    };
    medallion(256, 192, 1.25);
    for (const [x, y] of [[112, 108], [400, 108], [112, 276], [400, 276]]) medallion(x, y, 0.42);
  });
  const rug = (w: number, d: number, x: number, z: number) => {
    // Tinted down: under the table spotlight a pure red rug would shout.
    const r = mesh(new THREE.PlaneGeometry(w, d), matte('#8f7468', { map: rugTex }), x, 0.012, z);
    r.rotation.x = -Math.PI / 2;
    r.receiveShadow = true;
  };
  const RUGS: Record<string, [number, number, number]> = {
    blackjack: [8.6, 6.6, 0.9],
    baccarat: [8.6, 6.6, 0.9],
    roulette: [7.4, 5.6, 0.5],
    poker: [7.6, 6, 0],
    russian: [4.6, 4.6, 0],
    liars: [5.6, 5.6, 0],
    meyer: [5, 5, 0],
  };
  for (const st of STATIONS) {
    const [w, d, dz] = RUGS[st.type] ?? [6, 6, 0];
    rug(w, d, st.x, st.z + dz);
  }
  rug(4.6, 3.2, 0, 11.6);
  rug(3.6, 10, -12.6, -2);

  // ---- walls: wood panelling from floor to ceiling ---------------------------------
  const panelTex = canvasTexture(512, 512, (c) => {
    const rnd = seeded(7);
    c.fillStyle = WOOD;
    c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = rnd() > 0.5 ? 'rgba(20,8,4,0.10)' : 'rgba(150,80,40,0.07)';
      c.fillRect(rnd() * 512, 0, 1 + rnd() * 3, 512);
    }
    c.strokeStyle = '#1e0d07';
    c.lineWidth = 12;
    c.strokeRect(54, 46, 404, 420);
    c.strokeStyle = 'rgba(160,92,50,0.55)';
    c.lineWidth = 4;
    c.strokeRect(64, 56, 384, 400);
    c.fillStyle = 'rgba(110,56,30,0.25)';
    c.fillRect(66, 58, 380, 396);
  });
  panelTex.wrapS = panelTex.wrapT = THREE.RepeatWrapping;
  const BAY = 2.6; // width of one wood panel

  /** Wall material for one stretch of wall, with the pattern scaled to its size. */
  const panelling = (w: number, h: number, base: THREE.Texture = panelTex, tint = '#ffffff', glow = '#ffb27a', bay = BAY, roomH = H) => {
    const tex = base.clone();
    tex.repeat.set(w / bay, h / roomH);
    tex.needsUpdate = true;
    // A faint glow of its own, so the detail survives in the dark corners.
    return matte(tint, { map: tex, emissive: glow, emissiveMap: tex, emissiveIntensity: 0.2 });
  };

  // The other rooms' wall finishes, so a wall shared by two rooms looks right from both sides.
  const greenPanel = (w: number, h: number) => panelling(w, h, GREEN_TEX(), '#ffffff', '#7fd0a0', 2.2, areaById('card').height);
  const parlourPanel = (w: number, h: number) => panelling(w, h, PARLOUR_TEX(), '#ffffff', '#c07aff', 1.6, areaById('dice').height);
  const brickPanel = (w: number, h: number) => {
    const t = BRICK_TEX().clone();
    t.repeat.set(w / 2.2, h / 2.2);
    t.needsUpdate = true;
    return matte('#c8b8b0', { map: t });
  };

  interface WallStyle {
    material: (w: number, h: number) => THREE.Material;
    /** Dark panelling along the bottom of the wall. */
    dado?: THREE.Material;
    /** Thin trim on top of the dado, and under the crown. */
    trim?: THREE.Material;
    crown?: THREE.Material;
  }
  type Side = 'n' | 's' | 'e' | 'w';
  interface WallOpts {
    /** Stretches (room coordinates along the side) another room's wall already covers. */
    omit?: Partial<Record<Side, [number, number][]>>;
    /** Stretches whose outside face looks into another room, and what that face should look like. */
    outer?: Partial<Record<Side, { a: number; b: number; material: (w: number, h: number) => THREE.Material }[]>>;
  }

  /**
   * The four walls of a room, with real holes wherever OPENINGS says there is a doorway.
   * Each side is a group whose local x runs along the wall and whose local +z points into the room.
   * Walls stand just outside the room; where two rooms meet, only one of them builds the wall.
   */
  const buildWalls = (area: (typeof AREAS)[number], style: WallStyle, opts: WallOpts = {}) => {
    const h = area.height;
    const cx = (area.x0 + area.x1) / 2;
    const cz = (area.z0 + area.z1) / 2;
    // Side, where it stands, how it turns, how long it is, and how to turn a room
    // coordinate along it into a local x.
    const sides = {
      n: { pos: [cx, area.z0], rot: 0, len: area.x1 - area.x0, line: 'z' as const, at: area.z0, local: (v: number) => v - cx },
      s: { pos: [cx, area.z1], rot: Math.PI, len: area.x1 - area.x0, line: 'z' as const, at: area.z1, local: (v: number) => -(v - cx) },
      w: { pos: [area.x0, cz], rot: Math.PI / 2, len: area.z1 - area.z0, line: 'x' as const, at: area.x0, local: (v: number) => -(v - cz) },
      e: { pos: [area.x1, cz], rot: -Math.PI / 2, len: area.z1 - area.z0, line: 'x' as const, at: area.x1, local: (v: number) => v - cz },
    };
    const out = {} as Record<Side, THREE.Group>;
    for (const [key, side] of Object.entries(sides) as [Side, (typeof sides)['n']][]) {
      const g = new THREE.Group();
      const range = (a: number, b: number) => [side.local(a), side.local(b)].sort((p, q) => p - q) as [number, number];
      const gaps = OPENINGS.filter((o) => o.line === side.line && Math.abs(o.at - side.at) < 1e-6)
        .map((o) => {
          const [a, b] = range(o.a, o.b);
          return { a, b, h: o.height, kind: o.kind };
        })
        .filter((gp) => gp.b > -side.len / 2 && gp.a < side.len / 2);
      const omits = (opts.omit?.[key] ?? []).map(([a, b]) => range(a, b));
      const outers = (opts.outer?.[key] ?? []).map((o) => ({ r: range(o.a, o.b), material: o.material }));
      // Cut the side wherever anything changes, then build each stretch.
      const cuts = new Set<number>([-side.len / 2, side.len / 2]);
      for (const [a, b] of [...gaps.map((gp) => [gp.a, gp.b]), ...omits, ...outers.map((o) => o.r)]) {
        cuts.add(Math.max(-side.len / 2, Math.min(side.len / 2, a)));
        cuts.add(Math.max(-side.len / 2, Math.min(side.len / 2, b)));
      }
      const pts = [...cuts].sort((p, q) => p - q);
      const inside = (m: number, [a, b]: [number, number]) => m > a && m < b;
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const w = b - a;
        if (w < 1e-3) continue;
        const mid = (a + b) / 2;
        if (omits.some((r) => inside(mid, r))) continue;
        const gap = gaps.find((gp) => inside(mid, [gp.a, gp.b]));
        const y0 = gap ? gap.h : 0;
        const wh = h - y0;
        if (wh > 0.01) {
          const inner = style.material(w, wh);
          const outer = outers.find((o) => inside(mid, o.r))?.material(w, wh) ?? inner;
          // Box faces: +x, -x, +y, -y, +z (into this room), -z (the far side).
          const wallMesh = new THREE.Mesh(box(w, wh, 0.3), [inner, inner, inner, inner, inner, outer]);
          wallMesh.position.set(mid, y0 + wh / 2, -0.15);
          wallMesh.receiveShadow = true;
          g.add(wallMesh);
        }
        if (!gap) {
          if (style.dado) mesh(box(w, 1.2, 0.1), style.dado, mid, 0.6, 0.05, g);
          if (style.trim) mesh(box(w, 0.07, 0.14), style.trim, mid, 1.24, 0.07, g);
        }
        if (style.crown) mesh(box(w, 0.36, 0.2), style.crown, mid, h - 0.18, 0.1, g);
        if (style.trim) mesh(box(w, 0.05, 0.24), style.trim, mid, h - 0.4, 0.12, g);
      }
      g.userData.gaps = gaps;
      g.position.set(side.pos[0], 0, side.pos[1]);
      g.rotation.y = side.rot;
      scene.add(g);
      out[key] = g;
    }
    return out;
  };

  const hallWalls = buildWalls(
    areaById('hall'),
    { material: (w, h) => panelling(w, h), dado: woodDark, trim: brass, crown: woodDark },
    {
      outer: {
        n: [{ a: -14, b: 14, material: greenPanel }], // the card room sees this side
        e: [{ a: 5, b: 15, material: parlourPanel }], // and the dice parlour this one
        w: [{ a: RESTROOM.z0, b: RESTROOM.z1, material: restroomTiles }], // and the restrooms this one
      },
    },
  );
  const back = hallWalls.n; // local x = world x
  const front = hallWalls.s; // local x = -world x
  const left = hallWalls.w; // local x = -world z
  const right = hallWalls.e; // local x = world z

  /** A wooden pilaster with a wall lamp, and the glow that lamp throws on the wall. */
  const sconce = (g: THREE.Group, x: number, roomH = H) => {
    mesh(box(0.46, roomH - 0.4, 0.14), woodDark, x, (roomH - 0.4) / 2, 0.07, g);
    mesh(box(0.16, 0.34, 0.06), brass, x, 3.05, 0.17, g);
    mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.26, 12), flat('#ffd9a3'), x, 3.22, 0.3, g);
    const pool = glowPlane('#ff8a3c', 3.6, 5.2, 0.6);
    pool.position.set(x, 3.4, 0.2);
    g.add(pool);
    const dot = glowSprite(LAMP, 0.9, 0.8);
    dot.position.set(x, 3.22, 0.32);
    g.add(dot);
  };
  for (const x of [-17.5, -12, -6, 6, 12, 17.5]) {
    sconce(back, x);
    sconce(front, x);
  }
  for (const x of [-11.5, -7, 12]) sconce(left, x);
  for (const x of [-12, 1.5, 13.5]) sconce(right, x);

  // ---- ceiling: dark, with a grid of heavy beams -----------------------------------
  const ceiling = mesh(new THREE.PlaneGeometry(W * 2, D * 2), matte('#170c07'), 0, H, 0);
  ceiling.rotation.x = Math.PI / 2;
  const beam = matte('#2f170d');
  for (const z of [-10, -5, 0, 5, 10]) mesh(box(W * 2, 0.36, 0.44), beam, 0, H - 0.18, z);
  for (const x of [-16, -8, 0, 8, 16]) mesh(box(0.44, 0.32, D * 2), beam, x, H - 0.16, 0);

  // ---- chandeliers ---------------------------------------------------------------
  const crystal = flat('#ffcf85', { transparent: true, opacity: 0.92 });
  const chandelier = (x: number, z: number, s: number, power: number, drop = 1.25, ceiling = H) => {
    const g = new THREE.Group();
    mesh(new THREE.CylinderGeometry(0.025, 0.025, drop, 6), brass, 0, -drop / 2, 0, g);
    const y = -drop - 0.55 * s;
    const basket = mesh(new THREE.SphereGeometry(0.62 * s, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), crystal, 0, y, 0, g);
    basket.scale.y = 1.25;
    const ring = (r: number, yy: number, tube = 0.035) => {
      mesh(new THREE.TorusGeometry(r * s, tube * s, 8, 28), brass, 0, yy, 0, g).rotation.x = Math.PI / 2;
    };
    ring(0.64, y);
    ring(0.86, y + 0.1 * s);
    ring(0.46, y + 0.5 * s);
    mesh(new THREE.CylinderGeometry(0.16 * s, 0.5 * s, 0.5 * s, 14, 1, true), crystal, 0, y + 0.27 * s, 0, g);
    mesh(new THREE.SphereGeometry(0.09 * s, 10, 8), brass, 0, y - 0.8 * s, 0, g);
    const candles = (n: number, r: number, yy: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        mesh(new THREE.SphereGeometry(0.055 * s, 8, 6), bulb, Math.cos(a) * r * s, yy, Math.sin(a) * r * s, g);
      }
    };
    candles(12, 0.86, y + 0.19 * s);
    candles(7, 0.46, y + 0.58 * s);
    const halo = glowSprite(LAMP, 4.6 * s, 0.5);
    halo.position.y = y;
    g.add(halo);
    if (power > 0) {
      const light = new THREE.PointLight(LAMP, power, 0, 2);
      light.position.y = y - 0.5 * s;
      g.add(light);
      flicker.push({ light, base: power, phase: x * 1.7 + z });
    }
    g.position.set(x, ceiling - 0.3, z);
    scene.add(g);
  };
  chandelier(0, 8.5, 1, 45);
  chandelier(12, -6.5, 0.9, 0);
  for (const [x, z] of [[-15.5, -12.2], [-9, 9.5], [9, 9.5], [0, -1.5], [0, -11.5]]) chandelier(x, z, 0.75, 0);
  // The other rooms light their own tables (see rooms.ts).
  for (const st of STATIONS.filter((s) => s.x > -20 && s.x < 20 && s.z > -15 && s.z < 15)) {
    // The big one hangs over the table, and a hidden spotlight does its real work:
    // the felt is the brightest thing in the room, and everything there casts a shadow.
    const dz = st.type === 'blackjack' ? 0.9 : 0;
    chandelier(st.x, st.z + dz, 1.4, 30, 0.9);
    const spot = new THREE.SpotLight('#ffe3b5', 46, 16, 0.82, 0.75, 1.5);
    spot.position.set(st.x, H - 0.5, st.z + dz + 0.4);
    spot.target.position.set(st.x, 0.9, st.z + dz - 0.2);
    spot.castShadow = st.type === 'blackjack';
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0008;
    spot.shadow.normalBias = 0.03;
    scene.add(spot, spot.target);
  }

  // ---- pillars: pale stone, deep red capitals ---------------------------------------
  const stone = matte('#c9a37c');
  const capital = matte('#7c241c');
  for (const p of DECOR.pillars) {
    mesh(new THREE.CylinderGeometry(0.52, 0.56, 0.5, 20), woodDark, p.x, 0.25, p.z).castShadow = true;
    mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.07, 20), brass, p.x, 0.53, p.z);
    mesh(new THREE.CylinderGeometry(0.38, 0.4, H - 1.3, 20), stone, p.x, 0.5 + (H - 1.3) / 2, p.z).castShadow = true;
    mesh(new THREE.CylinderGeometry(0.74, 0.42, 0.62, 20), capital, p.x, H - 0.5, p.z);
    mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 20), brass, p.x, H - 0.84, p.z);
    mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.1, 20), brass, p.x, H - 0.2, p.z);
    const up = glowSprite('#ff8a3c', 2.6, 0.32);
    up.position.set(p.x, H - 1.5, p.z);
    scene.add(up);
  }

  // ---- potted palms -------------------------------------------------------------
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.45, 0.22, 1, 0);
  leafShape.quadraticCurveTo(0.45, -0.22, 0, 0);
  const leafGeo = new THREE.ShapeGeometry(leafShape, 6);
  leafGeo.rotateX(-Math.PI / 2);
  const leafMats = [
    toon('#2f7a47', { side: THREE.DoubleSide, emissive: '#0d2414' }),
    toon('#256339', { side: THREE.DoubleSide, emissive: '#0a1c10' }),
  ];
  const trunkMat = matte('#4d3523');
  const planter = matte('#6e4d22', { emissive: '#1f1408' });
  DECOR.plants.forEach((p, pi) => {
    const rnd = seeded(31 + pi * 17);
    mesh(new THREE.CylinderGeometry(0.44, 0.34, 0.62, 16), planter, p.x, 0.31, p.z).castShadow = true;
    mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 16), brass, p.x, 0.63, p.z);
    let x = p.x;
    let z = p.z;
    let y = 0.62;
    const lean = { x: (rnd() - 0.5) * 0.09, z: (rnd() - 0.5) * 0.09 };
    for (let i = 0; i < 7; i++) {
      mesh(new THREE.CylinderGeometry(0.1 + (6 - i) * 0.006, 0.12 + (6 - i) * 0.006, 0.42, 9), trunkMat, x, y + 0.2, z).castShadow = true;
      y += 0.39;
      x += lean.x;
      z += lean.z;
    }
    const crown = new THREE.Group();
    crown.position.set(x, y, z);
    const fronds = 9;
    for (let i = 0; i < fronds; i++) {
      const frond = new THREE.Group();
      frond.rotation.y = (i / fronds) * Math.PI * 2 + rnd() * 0.4;
      const inner = new THREE.Group();
      inner.rotation.z = 0.45 + rnd() * 0.35;
      const mat = leafMats[i % 2];
      const a = new THREE.Mesh(leafGeo, mat);
      a.scale.set(1.0, 1, 1.25);
      const outer = new THREE.Group();
      outer.position.x = 0.92;
      outer.rotation.z = -(0.95 + rnd() * 0.4);
      const b = new THREE.Mesh(leafGeo, mat);
      b.scale.set(0.95, 1, 1.05);
      outer.add(b);
      inner.add(a, outer);
      frond.add(inner);
      crown.add(frond);
    }
    scene.add(crown);
  });

  // ---- the sign behind the main table ----------------------------------------------
  const signTex = canvasTexture(1024, 300, (c) => {
    c.fillStyle = '#1a0e09';
    c.beginPath();
    c.roundRect(4, 4, 1016, 292, 26);
    c.fill();
    c.strokeStyle = BRASS;
    c.lineWidth = 6;
    c.stroke();
    c.shadowColor = '#ffb040';
    c.shadowBlur = 14;
    c.fillStyle = '#ffe6ad';
    for (let x = 40; x <= 984; x += 59) {
      for (const y of [30, 270]) {
        c.beginPath();
        c.arc(x, y, 7, 0, Math.PI * 2);
        c.fill();
      }
    }
    for (const x of [40, 984]) {
      for (const y of [90, 150, 210]) {
        c.beginPath();
        c.arc(x, y, 7, 0, Math.PI * 2);
        c.fill();
      }
    }
    const gold = c.createLinearGradient(0, 80, 0, 230);
    gold.addColorStop(0, '#ffe7a8');
    gold.addColorStop(0.55, '#e0b25a');
    gold.addColorStop(1, '#a87a2c');
    c.font = `italic 700 136px ${SERIF}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = '#ff9a2e';
    c.shadowBlur = 30;
    c.fillStyle = gold;
    c.fillText(GAME_NAME, 512, 154, 880);
  });
  // Above the great arch into the card room.
  const signGlow = glowPlane('#ff8a3c', 9, 3.4, 0.4);
  signGlow.position.set(0, 5.55, 0.04);
  back.add(signGlow);
  mesh(box(6.1, 1.95, 0.1), brass, 0, 5.55, 0.05, back);
  mesh(new THREE.PlaneGeometry(5.9, 1.73), flat('#ffffff', { map: signTex }), 0, 5.55, 0.11, back);
  // Stone columns either side of the arch.
  const archStone = matte('#c9a37c');
  for (const sx of [-1, 1]) {
    const x = sx * 4.75;
    mesh(new THREE.CylinderGeometry(0.28, 0.3, 4.4, 16), archStone, x, 2.2, 0.15, back).castShadow = true;
    mesh(new THREE.BoxGeometry(0.75, 0.25, 0.6), brass, x, 4.45, 0.15, back);
    mesh(new THREE.BoxGeometry(0.75, 0.3, 0.6), woodDark, x, 0.15, 0.15, back);
  }
  mesh(box(10, 0.3, 0.6), woodDark, 0, 4.55, 0.15, back);

  // ---- oil paintings of very serious little blobs --------------------------------------
  const portrait = (seed: number) =>
    canvasTexture(256, 320, (c) => {
      const rnd = seeded(101 + seed * 13);
      const bg = c.createRadialGradient(128, 130, 20, 128, 160, 220);
      bg.addColorStop(0, ['#5a3a22', '#3d3a2a', '#4a2a2a', '#2f3440'][seed % 4]);
      bg.addColorStop(1, '#120b08');
      c.fillStyle = bg;
      c.fillRect(0, 0, 256, 320);
      c.fillStyle = COLORS[(seed * 3 + 1) % COLORS.length];
      c.beginPath();
      c.ellipse(128, 318, 78, 110, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#f0cfa8';
      c.beginPath();
      c.ellipse(128, 150, 66, 60, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#2b2238';
      for (const sx of [-1, 1]) {
        c.beginPath();
        c.ellipse(128 + sx * 24, 146, 8, 11, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = 'rgba(255,140,150,0.75)';
      for (const sx of [-1, 1]) {
        c.beginPath();
        c.ellipse(128 + sx * 42, 166, 11, 7, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.strokeStyle = '#2b2238';
      c.lineWidth = 4;
      c.lineCap = 'round';
      c.beginPath();
      if (seed % 2) {
        c.moveTo(114, 174);
        c.lineTo(142, 174);
      } else {
        c.arc(128, 168, 12, 0.15 * Math.PI, 0.85 * Math.PI);
      }
      c.stroke();
      c.fillStyle = '#17121c';
      if (seed % 4 === 0) {
        c.fillRect(84, 88, 88, 12);
        c.fillRect(98, 34, 60, 58);
        c.fillStyle = BRASS;
        c.fillRect(98, 78, 60, 10);
      } else if (seed % 4 === 1) {
        c.fillStyle = '#e0b25a';
        c.beginPath();
        c.moveTo(86, 100);
        c.lineTo(86, 62);
        c.lineTo(107, 84);
        c.lineTo(128, 54);
        c.lineTo(149, 84);
        c.lineTo(170, 62);
        c.lineTo(170, 100);
        c.fill();
      } else if (seed % 4 === 2) {
        c.strokeStyle = BRASS;
        c.lineWidth = 4;
        c.beginPath();
        c.arc(152, 146, 17, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        c.moveTo(166, 158);
        c.lineTo(176, 214);
        c.stroke();
        c.fillStyle = '#3a2416';
        c.beginPath();
        c.ellipse(128, 186, 30, 8, 0, 0, Math.PI * 2);
        c.fill();
      } else {
        c.fillStyle = '#ef4565';
        for (const sx of [-1, 1]) {
          c.beginPath();
          c.moveTo(128, 220);
          c.lineTo(128 + sx * 34, 204);
          c.lineTo(128 + sx * 34, 238);
          c.fill();
        }
      }
      for (let i = 0; i < 70; i++) {
        c.fillStyle = `rgba(${rnd() > 0.5 ? '255,220,170' : '0,0,0'},${0.03 + rnd() * 0.04})`;
        c.fillRect(rnd() * 256, rnd() * 320, 10 + rnd() * 40, 2 + rnd() * 3);
      }
      const varnish = c.createRadialGradient(128, 140, 60, 128, 160, 230);
      varnish.addColorStop(0, 'rgba(0,0,0,0)');
      varnish.addColorStop(1, 'rgba(0,0,0,0.6)');
      c.fillStyle = varnish;
      c.fillRect(0, 0, 256, 320);
    });
  const painting = (g: THREE.Group, x: number, seed: number, y = 3.4) => {
    mesh(box(1.72, 2.1, 0.09), brass, x, y, 0.05, g);
    const art = portrait(seed);
    mesh(new THREE.PlaneGeometry(1.5, 1.88), matte('#ffffff', { map: art, emissive: '#ffffff', emissiveMap: art, emissiveIntensity: 0.28 }), x, y, 0.1, g);
    mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8), brass, x, y + 1.22, 0.24, g).rotation.z = Math.PI / 2;
    const pool = glowPlane('#ffb766', 2.3, 2.6, 0.3);
    pool.position.set(x, y + 0.25, 0.12);
    g.add(pool);
  };
  [-15, -9, 9, 15].forEach((x, i) => painting(back, x, i));
  [-15, -9, 9, 15].forEach((x, i) => painting(front, x, i + 4));
  painting(left, 3, 8); // (moved along: the restroom door is where it used to hang)
  painting(left, 9.8, 9);
  painting(right, -1.6, 10);

  // ---- the entrance: a real doorway out to the street (the doors themselves swing, see doors.ts) ----
  const en = DOORS.entrance;
  for (const sx of [-1, 1]) mesh(box(0.25, en.height + 0.25, 0.5), woodDark, sx * (en.width / 2 + 0.125), (en.height + 0.25) / 2, -0.1, front);
  mesh(box(en.width + 0.5, 0.25, 0.5), woodDark, 0, en.height + 0.125, -0.1, front);
  const plaque = canvasTexture(512, 128, (c) => {
    c.fillStyle = '#8a6a2e';
    c.fillRect(0, 0, 512, 128);
    c.strokeStyle = '#3a2a10';
    c.lineWidth = 6;
    c.strokeRect(10, 10, 492, 108);
    c.fillStyle = '#2a1a08';
    c.font = `700 62px ${SERIF}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('NO REFUNDS', 256, 68);
  });
  mesh(new THREE.PlaneGeometry(1.6, 0.4), matte('#ffffff', { map: plaque, emissive: '#ffffff', emissiveMap: plaque, emissiveIntensity: 0.35 }), 0, en.height + 0.6, 0.13, front);

  // ---- the cashier's booth, beside the entrance: where chips become money -----------------
  {
    const c = CASHIER;
    const booth = matte('#2b140b');
    mesh(box(2.8, 1.1, 0.8), booth, c.x, 0.55, 14.6).castShadow = true;
    mesh(box(2.9, 0.08, 0.9), brass, c.x, 1.12, 14.6);
    for (let i = 0; i <= 8; i++) mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 6), brass, c.x - 1.35 + i * 0.3375, 1.7, 14.25);
    mesh(box(2.8, 0.1, 0.1), brass, c.x, 2.25, 14.25);
    mesh(box(2.8, 0.3, 0.8), booth, c.x, 2.4, 14.6);
    mesh(box(2.8, 2.6, 0.06), matte('#1a0d07'), c.x, 1.3, 14.97);
    const signTexC = canvasTexture(512, 96, (g) => {
      g.fillStyle = '#1a0e09';
      g.fillRect(0, 0, 512, 96);
      g.font = `italic 700 64px ${SERIF}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = '#ffb040';
      g.shadowBlur = 18;
      g.fillStyle = '#f0c77a';
      g.fillText('Cashier', 256, 52);
    });
    const sign = mesh(new THREE.PlaneGeometry(1.9, 0.36), flat('#ffffff', { map: signTexC }), c.x, 2.85, 14.18);
    sign.rotation.y = Math.PI;
    const lampC = glowSprite(LAMP, 1.8, 0.55);
    lampC.position.set(c.x, 2.0, 14.5);
    scene.add(lampC);
    mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), brass, c.x + 0.9, 1.16, 14.3);
  }

  // ---- the restrooms' door, in the left wall (the room itself is built with the others) ----
  {
    const d = RESTROOM.door;
    // The frame, on the hall side: local x = -world z.
    for (const sz of [-1, 1]) mesh(box(0.16, d.h + 0.12, 0.14), woodDark, -d.z + sz * (d.w / 2 + 0.08), (d.h + 0.12) / 2, 0.07, left);
    mesh(box(d.w + 0.32, 0.16, 0.14), woodDark, -d.z, d.h + 0.08, 0.07, left);
  }
  // ---- the exit: a real door in the right-hand wall, out to the alley -----------------------
  const ex = DOORS.exit;
  for (const sx of [-1, 1]) mesh(box(0.22, ex.height + 0.2, 0.16), woodDark, ex.z + sx * (ex.width / 2 + 0.11), (ex.height + 0.2) / 2, 0.06, right);
  mesh(box(ex.width + 0.66, 0.24, 0.16), woodDark, ex.z, ex.height + 0.12, 0.06, right);
  const exitDoors: THREE.Object3D[] = [];
  const exitLeaf = matte('#4a1712');
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(ex.z + (side * ex.width) / 2, 0, -0.15);
    const leafW = ex.width / 2 - 0.03;
    const cx = (-side * leafW) / 2;
    mesh(box(leafW, ex.height - 0.04, 0.07), exitLeaf, cx, (ex.height - 0.04) / 2, 0, pivot).castShadow = true;
    mesh(box(leafW * 0.75, 0.06, 0.06), brass, cx, 1.1, 0.06, pivot);
    mesh(box(leafW * 0.6, 0.5, 0.02), woodDark, cx, 2.4, 0.04, pivot);
    pivot.userData.openSign = -side; // swings outward, into the alley
    right.add(pivot);
    exitDoors.push(pivot);
  }
  const exitSign = canvasTexture(256, 96, (c) => {
    c.fillStyle = '#1a0605';
    c.fillRect(0, 0, 256, 96);
    c.font = `700 70px ${SERIF}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = '#ff2a1a';
    c.shadowBlur = 18;
    c.fillStyle = '#ff6a55';
    c.fillText('EXIT', 128, 52);
  });
  mesh(box(1.3, 0.5, 0.12), woodDark, ex.z, ex.height + 0.62, 0.08, right);
  mesh(new THREE.PlaneGeometry(1.2, 0.45), flat('#ffffff', { map: exitSign }), ex.z, ex.height + 0.62, 0.15, right);
  const redGlow = glowPlane('#ff3020', 3.2, 2.2, 0.35);
  redGlow.position.set(ex.z, ex.height + 0.5, 0.1);
  right.add(redGlow);

  // ---- the bar, along the left wall ---------------------------------------------------
  buildBar();

  // ---- the alley, outside the exit ---------------------------------------------------
  buildAlley();

  // ---- the card room, the back room, the dice parlour, and the hall's furniture -------------
  const rooms = buildRooms({
    scene,
    mesh,
    box,
    buildWalls,
    panelling,
    panelTex,
    chandelier,
    sconce,
    painting,
    flicker,
    woodDark,
    brass,
    hallRight: right,
    hallLeft: left,
    greenPanel,
    parlourPanel,
    brickPanel,
  });

  // ---- the board of who got furthest ---------------------------------------------------
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 512;
  boardCanvas.height = 448;
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  boardTex.anisotropy = 8;
  mesh(box(3.45, 3.05, 0.09), brass, 4.6, 3.2, 0.05, right);
  mesh(new THREE.PlaneGeometry(3.2, 2.8), flat('#ffffff', { map: boardTex }), 4.6, 3.2, 0.11, right);
  const boardGlow = glowPlane('#ffb766', 4.4, 3.6, 0.22);
  boardGlow.position.set(4.6, 3.4, 0.13);
  right.add(boardGlow);

  const setLeaderboard = (list: LeaderboardEntry[]) => {
    const c = boardCanvas.getContext('2d')!;
    c.fillStyle = '#100a07';
    c.fillRect(0, 0, 512, 448);
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    c.fillStyle = '#e0b25a';
    c.font = `italic 700 56px ${SERIF}`;
    c.fillText('Deepest Runs', 256, 52);
    c.fillStyle = '#6b5226';
    c.fillRect(60, 90, 392, 2);
    c.font = `700 36px ${SERIF}`;
    list.slice(0, 8).forEach((row, i) => {
      const y = 128 + i * 41;
      c.fillStyle = i === 0 ? '#ffd98a' : '#e8dcc4';
      c.textAlign = 'left';
      c.fillText(`${i + 1}.  ${row.name}`, 36, y);
      c.textAlign = 'right';
      const round = `Round ${row.best}`;
      c.fillText(round, 476, y);
      // The level that run was played at, small, in front of the round.
      const w = c.measureText(round).width;
      c.font = `700 20px ${SERIF}`;
      c.fillStyle = LEVEL_COLORS[row.level] ?? '#b8aa98';
      c.fillText(DIFFICULTIES[row.level]?.label ?? '', 476 - w - 12, y + 3);
      c.font = `700 36px ${SERIF}`;
    });
    boardTex.needsUpdate = true;
  };
  setLeaderboard([]);

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  // ---- outside: the street, the building, the hallway, the apartments --------------------
  const outside = buildOutside(stage);
  // Each zone has its own air: warm smoke in the casino, a cold night outside, stale and close at home.
  const MOODS: Record<'casino' | 'street' | 'hall' | 'apt', { bg: string; fog: string; density: number; sky: string; ground: string; sun: number }> = {
    casino: { bg: '#0b0705', fog: '#150b07', density: 0.018, sky: '#ffc493', ground: '#2a140b', sun: 0.75 },
    street: { bg: '#070a16', fog: '#0c1222', density: 0.011, sky: '#7d8fc0', ground: '#1a1420', sun: 0.6 },
    hall: { bg: '#0a0906', fog: '#16140c', density: 0.05, sky: '#d8e0b0', ground: '#2a2416', sun: 0.55 },
    apt: { bg: '#0a0708', fog: '#140d10', density: 0.04, sky: '#ffc8a0', ground: '#2a1a16', sun: 0.5 },
  };
  let zone: ZoneKey = 'casino';
  const mood = { bg: new THREE.Color(), fog: new THREE.Color(), sky: new THREE.Color(), ground: new THREE.Color(), density: 0, sun: 0 };
  const moodOf = (z: ZoneKey) => MOODS[z.startsWith('apt:') ? 'apt' : (z as 'casino' | 'street' | 'hall')];
  /** Snap (or, walking through a door, ease) the air to the zone you are in. */
  const applyMood = (k: number) => {
    const m = moodOf(zone);
    mood.bg.lerp(new THREE.Color(m.bg), k);
    mood.fog.lerp(new THREE.Color(m.fog), k);
    mood.sky.lerp(new THREE.Color(m.sky), k);
    mood.ground.lerp(new THREE.Color(m.ground), k);
    mood.density += (m.density - mood.density) * k;
    mood.sun += (m.sun - mood.sun) * k;
    (stage.background as THREE.Color).copy(mood.bg);
    fog.color.copy(mood.fog);
    fog.density = mood.density;
    sky.color.copy(mood.sky);
    sky.groundColor.copy(mood.ground);
    sky.intensity = mood.sun;
  };
  /**
   * You are in `z`; `seen` is every zone you can see into from here (through open doorways).
   * Everything else is hidden. `snap` jumps the air straight to the new zone's.
   */
  const setZone = (z: ZoneKey, seen: Iterable<ZoneKey> = [z], snap = true) => {
    zone = z;
    const show = new Set<ZoneKey>([z, ...seen]);
    scene.visible = show.has('casino');
    outside.street.visible = show.has('street');
    outside.hall.visible = show.has('hall');
    outside.apts.forEach((a, i) => (a.visible = show.has(`apt:${i}`)));
    if (snap) applyMood(1);
  };

  return {
    renderer,
    scene: stage,
    casino: scene,
    street: outside.street,
    camera,
    exitDoors,
    secretDoor: rooms.secretDoor,
    setLeaderboard,
    setZone,
    get zone() {
      return zone;
    },
    setLobby: (info) => outside.setLobby(info),
    resize,
    update(dt, time) {
      rooms.update(time);
      outside.update(dt, time, zone);
      applyMood(1 - Math.exp(-dt * 3));
      // Candlelight is never quite steady.
      for (const f of flicker) {
        f.light.intensity = f.base * (1 + Math.sin(time * 7.3 + f.phase) * 0.025 + Math.sin(time * 13.1 + f.phase * 2) * 0.015);
      }
    },
  };

  // =====================================================================================

  function buildBar() {
    const barWood = matte('#3b1b0f');
    const marble = matte('#2b2522', { emissive: '#0c0806' });
    const len = BAR.z1 - BAR.z0;
    const zc = (BAR.z0 + BAR.z1) / 2;
    const depth = 0.76;
    const cx = BAR.front - depth / 2;

    // The counter: dark wood, a marble top with a brass lip, a brass foot rail.
    const counter = mesh(box(depth, 1.08, len), barWood, cx, 0.54, zc);
    counter.castShadow = counter.receiveShadow = true;
    for (let z = BAR.z0 + 0.75; z < BAR.z1; z += 1.5) mesh(box(0.04, 0.62, 1.15), woodDark, BAR.front + 0.01, 0.56, z);
    mesh(box(0.94, 0.07, len + 0.16), marble, cx + 0.06, 1.115, zc).receiveShadow = true;
    mesh(box(0.03, 0.04, len + 0.16), brass, BAR.front + 0.14, 1.07, zc);
    mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 10), brass, BAR.front + 0.24, 0.2, zc).rotation.x = Math.PI / 2;
    for (let z = BAR.z0 + 0.4; z < BAR.z1; z += 2) mesh(box(0.24, 0.04, 0.04), brass, BAR.front + 0.12, 0.2, z);
    // The two ends turn back to the wall, so the space behind belongs to the bartender.
    const backOfCounter = cx - depth / 2;
    const returnLen = backOfCounter + W;
    for (const z of [BAR.z0 + 0.35, BAR.z1 - 0.35]) {
      mesh(box(returnLen, 1.08, 0.7), barWood, -W + returnLen / 2, 0.54, z);
      mesh(box(returnLen, 0.07, 0.8), marble, -W + returnLen / 2, 1.115, z);
    }

    // The bartender stands on a raised floor, so he can see over his own counter.
    const step = BAR_PLATFORM;
    mesh(box(backOfCounter + W - 0.6, step, len - 1.4), woodDark, (-W + 0.6 + backOfCounter) / 2, step / 2, zc);

    // Back bar: a cabinet, a smoky mirror, three shelves of glowing bottles.
    const bx = -W + 0.3;
    mesh(box(0.6, 1.0, len - 1.4), barWood, bx, 0.5, zc);
    mesh(box(0.66, 0.05, len - 1.3), marble, bx + 0.03, 1.02, zc);
    const mirror = mesh(new THREE.PlaneGeometry(len - 1.6, 2.2), matte('#2b3038', { emissive: '#161b22' }), -W + 0.04, 2.3, zc);
    mirror.rotation.y = Math.PI / 2;
    const amber = glowPlane('#ff9a40', len, 2.6, 0.35);
    amber.position.set(-W + 0.06, 2.2, zc);
    amber.rotation.y = Math.PI / 2;
    scene.add(amber);
    const shelfYs = [1.55, 2.12, 2.69];
    for (const y of shelfYs) mesh(box(0.34, 0.04, len - 1.6), brass, -W + 0.2, y, zc);

    const bottleGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.24, 10);
    bottleGeo.translate(0, 0.12, 0);
    const neckGeo = new THREE.CylinderGeometry(0.016, 0.022, 0.1, 8);
    neckGeo.translate(0, 0.29, 0);
    const tints = ['#c9771f', '#7a3b12', '#3c7d3a', '#b8c9a8', '#8a1f2a', '#d9a441', '#2f5f6e', '#e0d0a0'];
    const perShelf = Math.floor((len - 1.8) / 0.2);
    const count = perShelf * shelfYs.length;
    const bodies = new THREE.InstancedMesh(bottleGeo, flat('#ffffff'), count);
    const necks = new THREE.InstancedMesh(neckGeo, flat('#ffffff'), count);
    const rnd = seeded(555);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    let n = 0;
    for (const y of shelfYs) {
      for (let i = 0; i < perShelf; i++) {
        const z = BAR.z0 + 0.9 + i * 0.2 + (rnd() - 0.5) * 0.04;
        const s = 0.8 + rnd() * 0.45;
        m4.makeScale(1, s, 1).setPosition(-W + 0.22, y + 0.02, z);
        bodies.setMatrixAt(n, m4);
        necks.setMatrixAt(n, m4);
        col.set(tints[Math.floor(rnd() * tints.length)]).multiplyScalar(0.5 + rnd() * 0.35);
        bodies.setColorAt(n, col);
        necks.setColorAt(n, col.multiplyScalar(0.7));
        n++;
      }
    }
    scene.add(bodies, necks);

    const barSign = canvasTexture(768, 160, (c) => {
      c.fillStyle = '#1a0e09';
      c.fillRect(0, 0, 768, 160);
      c.strokeStyle = BRASS;
      c.lineWidth = 6;
      c.strokeRect(8, 8, 752, 144);
      c.font = `italic 700 92px ${SERIF}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.shadowColor = '#ff9a2e';
      c.shadowBlur = 22;
      c.fillStyle = '#f0c77a';
      c.fillText('Last Orders', 384, 84);
    });
    const sign = mesh(new THREE.PlaneGeometry(3.6, 0.75), flat('#ffffff', { map: barSign }), -W + 0.33, 3.85, zc);
    sign.rotation.y = Math.PI / 2;

    // On the counter: a brass beer tower, a few glasses, a bell.
    const top = 1.15;
    mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.5, 12), brass, cx, top + 0.25, -2.2);
    mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), brass, cx, top + 0.45, -2.2).rotation.x = Math.PI / 2;
    ['#7a1c1e', '#1f3d30', '#b08a45'].forEach((c, i) => mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.2, 8), matte(c), cx + 0.04, top + 0.56, -2.38 + i * 0.18));
    const glassMat = flat('#cfe3ea', { transparent: true, opacity: 0.35 });
    for (const z of [-6.3, -3.7, 0.9, 2.6]) mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.13, 12, 1, true), glassMat, BAR.front - 0.12, top + 0.065, z);
    mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), brass, BAR.front - 0.15, top, 3.4);

    // Pendant lamps over the counter, and one real light to work by.
    const shade = flat('#e9a74a', { side: THREE.DoubleSide });
    for (const z of [-6.5, -3.5, -0.5, 2.5]) {
      mesh(new THREE.CylinderGeometry(0.012, 0.012, H - 3.2, 6), brass, cx, (H + 3.2) / 2, z);
      mesh(new THREE.ConeGeometry(0.26, 0.3, 16, 1, true), shade, cx, 3.05, z);
      const glow = glowSprite(LAMP, 1.6, 0.7);
      glow.position.set(cx, 2.92, z);
      scene.add(glow);
    }
    const light = new THREE.PointLight('#ffb766', 40, 0, 2);
    light.position.set(cx - 0.6, 2.9, zc);
    scene.add(light);
    flicker.push({ light, base: 40, phase: 3.3 });

    // Bar stools.
    const leather = matte('#6a2619');
    for (const z of BAR.stools) {
      mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.04, 18), woodDark, BAR.stoolX, 0.02, z);
      mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.76, 10), brass, BAR.stoolX, 0.4, z);
      mesh(new THREE.TorusGeometry(0.2, 0.018, 6, 20), brass, BAR.stoolX, 0.3, z).rotation.x = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.12, 20), leather, BAR.stoolX, 0.82, z).castShadow = true;
    }
  }

  function buildAlley() {
    const brick = BRICK_TEX();
    const brickMat = (w: number, h: number) => {
      const t = brick.clone();
      t.repeat.set(w / 2.2, h / 2.2);
      t.needsUpdate = true;
      return matte('#ffffff', { map: t });
    };
    const asphalt = canvasTexture(256, 256, (c) => {
      const rnd = seeded(91);
      c.fillStyle = '#2a2c31';
      c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 900; i++) {
        const v = 30 + rnd() * 40;
        c.fillStyle = `rgba(${v},${v},${v + 6},0.5)`;
        c.fillRect(rnd() * 256, rnd() * 256, 2, 2);
      }
    });
    asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
    asphalt.repeat.set(3, 8);

    const x0 = W;
    const x1 = ALLEY.x1;
    const wide = x1 - x0;
    const long = ALLEY.z1 - ALLEY.z0;
    const zc = (ALLEY.z0 + ALLEY.z1) / 2;
    const wallH = 6;

    const ground = mesh(new THREE.PlaneGeometry(wide, long), matte('#ffffff', { map: asphalt }), x0 + wide / 2, 0.003, zc);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    const puddle = mesh(new THREE.CircleGeometry(1, 24), flat('#141b28'), W + 3.4, 0.01, -10.6);
    puddle.rotation.x = -Math.PI / 2;
    puddle.scale.set(1.5, 0.9, 1);

    // Brick on all sides: the far wall, both dead ends, and the back of the casino with the door in it.
    const far = mesh(new THREE.PlaneGeometry(long, wallH), brickMat(long, wallH), x1, wallH / 2, zc);
    far.rotation.y = -Math.PI / 2;
    const endA = mesh(new THREE.PlaneGeometry(wide, wallH), brickMat(wide, wallH), x0 + wide / 2, wallH / 2, ALLEY.z0);
    endA.rotation.y = 0;
    const endB = mesh(new THREE.PlaneGeometry(wide, wallH), brickMat(wide, wallH), x0 + wide / 2, wallH / 2, ALLEY.z1);
    endB.rotation.y = Math.PI;
    const ex = DOORS.exit;
    const outer = (za: number, zb: number, y0: number, y1: number) => {
      const p = mesh(new THREE.PlaneGeometry(zb - za, y1 - y0), brickMat(zb - za, y1 - y0), ALLEY.x0 + 0.01, (y0 + y1) / 2, (za + zb) / 2);
      p.rotation.y = Math.PI / 2;
    };
    outer(ALLEY.z0, ex.z - ex.width / 2, 0, H);
    outer(ex.z + ex.width / 2, ALLEY.z1, 0, H);
    outer(ex.z - ex.width / 2, ex.z + ex.width / 2, ex.height, H);
    const steel = matte('#3a3d44');
    for (const sz of [-1, 1]) mesh(box(0.1, ex.height + 0.1, 0.12), steel, ALLEY.x0 + 0.05, ex.height / 2, ex.z + sz * (ex.width / 2 + 0.06));
    mesh(box(0.1, 0.12, ex.width + 0.24), steel, ALLEY.x0 + 0.05, ex.height + 0.06, ex.z);

    // A caged bulb over the door, and one cold street lamp further down.
    mesh(box(0.2, 0.2, 0.2), steel, ALLEY.x0 + 0.15, ex.height + 0.5, ex.z);
    const cage = glowSprite('#cfe0ff', 1.3, 0.9);
    cage.position.set(ALLEY.x0 + 0.3, ex.height + 0.42, ex.z);
    scene.add(cage);
    const doorLight = new THREE.PointLight('#bcd0ff', 9, 0, 2);
    doorLight.position.set(ALLEY.x0 + 0.6, ex.height + 0.3, ex.z);
    scene.add(doorLight);

    const lampZ = -10.5;
    mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.6, 10), steel, x1 - 0.4, 2.3, lampZ);
    mesh(box(1.1, 0.06, 0.06), steel, x1 - 0.95, 4.55, lampZ);
    mesh(new THREE.ConeGeometry(0.28, 0.24, 14, 1, true), steel, x1 - 1.45, 4.45, lampZ);
    const lampGlow = glowSprite('#a8c4ff', 2.4, 0.9);
    lampGlow.position.set(x1 - 1.45, 4.3, lampZ);
    scene.add(lampGlow);
    const street = new THREE.PointLight('#9fb8ff', 26, 0, 2);
    street.position.set(x1 - 1.45, 4.1, lampZ);
    scene.add(street);

    // A dumpster, rubbish bags, crates, a drainpipe.
    const green = matte('#2f4a35');
    mesh(box(1.3, 1.15, 2.2), green, x1 - 0.8, 0.6, -14.3).castShadow = true;
    const lid = mesh(box(1.36, 0.08, 2.26), matte('#26392b'), x1 - 0.8, 1.22, -14.3);
    lid.rotation.z = 0.12;
    const bag = matte('#141418');
    for (const [x, z, r] of [[x1 - 1.8, -13.2, 0.35], [x1 - 1.6, -12.6, 0.28], [x1 - 0.5, -12.8, 0.3]]) {
      mesh(new THREE.SphereGeometry(r, 12, 10), bag, x, r * 0.8, z).scale.y = 0.8;
    }
    const crate = matte('#5a3c22');
    mesh(box(0.7, 0.7, 0.7), crate, x0 + 0.8, 0.35, 1.8).rotation.y = 0.3;
    mesh(box(0.6, 0.6, 0.6), crate, x0 + 0.85, 1.0, 1.75).rotation.y = -0.2;
    mesh(new THREE.CylinderGeometry(0.07, 0.07, wallH, 8), steel, x1 - 0.1, wallH / 2, -4);
  }
}
