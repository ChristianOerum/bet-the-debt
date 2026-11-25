// Everything that is not the casino: the street outside it, the apartment building
// across the road, the hallway inside that building, and everyone's apartment.
import * as THREE from 'three';
import { APT_SLOTS, aptDeskLocal, aptDoor, aptFurnitureLocal, aptFrame, aptLayout, aptSize, CASINO_DOOR, DECOR, DOOR_SIZES, GAME_NAME, HALLWAY, type LobbyInfo, type ZoneKey } from '@casino/shared';
import { buildCharacter, partsOf, updateArms } from './character';
import { TextSprite } from './labels';
import { buildToilet } from './pee';
import { makeMirror } from './mirror';
import { canvasTexture, flat, glowPlane, glowSprite, matte, SERIF, toon, toonBright } from './materials';

export interface Outside {
  street: THREE.Group;
  hall: THREE.Group;
  apts: THREE.Group[];
  setLobby(info: LobbyInfo): void;
  update(dt: number, time: number, zone: ZoneKey): void;
}

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number, parent: THREE.Object3D) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
};
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const plane = (w: number, h: number) => new THREE.PlaneGeometry(w, h);

function repeatTex(t: THREE.Texture, rx: number, ry: number) {
  const c = t.clone();
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

/** Free the GPU memory of something that is being thrown away. */
function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat && 'dispose' in mat) (mat as THREE.Material).dispose();
  });
}

export function buildOutside(stage: THREE.Scene): Outside {
  const street = new THREE.Group();
  const hall = new THREE.Group();
  street.visible = hall.visible = false;
  stage.add(street, hall);
  const streetAnim = buildStreet(street);
  const hallway = buildHallway(hall);
  /** What each flat was last built as (its level and what is in it), to know when to rebuild it. */
  const built = Array<string>(APT_SLOTS).fill('1|');
  const apts: { group: THREE.Group; anim: (t: number) => void }[] = [];
  for (let s = 0; s < APT_SLOTS; s++) {
    const a = buildApartment(s, 1);
    a.group.visible = false;
    stage.add(a.group);
    apts.push(a);
  }

  return {
    street,
    hall,
    get apts() {
      return apts.map((a) => a.group);
    },
    setLobby(info) {
      hallway.setNames(info);
      // Somebody's apartment changed (bigger, or new things in it): rebuild it.
      for (let s = 0; s < APT_SLOTS; s++) {
        const m = info.members.find((x) => x.slot === s);
        const level = m?.aptLevel ?? 1;
        const home = m?.home ?? [];
        const key = `${level}|${[...home].sort().join(',')}`;
        if (built[s] === key) continue;
        built[s] = key;
        const old = apts[s];
        const visible = old.group.visible;
        stage.remove(old.group);
        disposeTree(old.group);
        const fresh = buildApartment(s, level, home);
        fresh.group.visible = visible;
        stage.add(fresh.group);
        apts[s] = fresh;
      }
    },
    update(dt, time, zone) {
      if (zone === 'street') streetAnim(dt, time);
      else if (zone === 'hall') hallway.anim(time);
      else if (zone.startsWith('apt:')) apts[Number(zone.slice(4))]?.anim(time);
    },
  };
}

// ---- textures ---------------------------------------------------------------------

/** A wall of windows: some lit warm, some blue with a TV, most dark. */
function windowsTexture(seed: number, cols: number, rows: number) {
  return canvasTexture(cols * 64, rows * 96, (c) => {
    const rnd = seeded(seed);
    c.fillStyle = '#2a1c1a';
    c.fillRect(0, 0, cols * 64, rows * 96);
    for (let i = 0; i < 400; i++) {
      c.fillStyle = `rgba(${rnd() > 0.5 ? '70,40,36' : '20,12,12'},0.4)`;
      c.fillRect(rnd() * cols * 64, rnd() * rows * 96, 14, 6);
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const r = rnd();
        c.fillStyle = r < 0.22 ? '#ffcf7a' : r < 0.3 ? '#7fa8ff' : r < 0.34 ? '#ff8fb0' : '#0e1018';
        c.fillRect(x * 64 + 14, y * 96 + 20, 36, 52);
        c.fillStyle = '#18100e';
        c.fillRect(x * 64 + 31, y * 96 + 20, 2, 52);
        c.fillRect(x * 64 + 12, y * 96 + 72, 40, 5);
      }
    }
  });
}

function concreteTexture(seed: number, base = '#4a4846') {
  return canvasTexture(256, 256, (c) => {
    const rnd = seeded(seed);
    c.fillStyle = base;
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const v = 50 + rnd() * 40;
      c.fillStyle = `rgba(${v},${v},${v + 4},0.35)`;
      c.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 2, 2);
    }
    c.strokeStyle = 'rgba(20,20,24,0.6)';
    c.lineWidth = 3;
    c.strokeRect(0, 0, 256, 256);
  });
}

// ---- the street ---------------------------------------------------------------------

function buildStreet(g: THREE.Group) {
  // Pavements, road, kerbs. Everything runs on well past where you can walk, into the fog.
  const pave = repeatTex(concreteTexture(5), 60, 4);
  const near = mesh(plane(120, 7.7), matte('#8a8680', { map: pave }), 0, 0.01, 19.2, g);
  near.rotation.x = -Math.PI / 2;
  const far = mesh(plane(120, 7.3), matte('#8a8680', { map: repeatTex(concreteTexture(6), 60, 4) }), 0, 0.01, 40.65, g);
  far.rotation.x = -Math.PI / 2;
  const roadTex = canvasTexture(256, 256, (c) => {
    const rnd = seeded(8);
    c.fillStyle = '#25262b';
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1500; i++) {
      const v = 30 + rnd() * 30;
      c.fillStyle = `rgba(${v},${v},${v + 6},0.5)`;
      c.fillRect(rnd() * 256, rnd() * 256, 2, 2);
    }
    c.fillStyle = '#d8c070';
    c.fillRect(0, 124, 120, 8); // dashed centre line
  });
  const road = mesh(plane(120, 14), matte('#ffffff', { map: repeatTex(roadTex, 30, 1) }), 0, 0.005, 30, g);
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  const kerb = matte('#6a6660');
  mesh(box(120, 0.14, 0.3), kerb, 0, 0.07, 23, g);
  mesh(box(120, 0.14, 0.3), kerb, 0, 0.07, 37, g);
  // A zebra crossing from the casino doors to the apartment building.
  for (let i = 0; i < 7; i++) mesh(box(0.5, 0.02, 13.4), flat('#cfc8b8'), -3 + i, 0.015, 30, g);
  // Red carpet out of the casino.
  const carpet = mesh(plane(2.6, 5.8), matte('#8a1a20'), 0, 0.02, 18.4, g);
  carpet.rotation.x = -Math.PI / 2;

  const brass = matte('#b08a45', { emissive: '#3a2a10' });

  // ---- the casino, from outside ----
  const stone = canvasTexture(256, 256, (c) => {
    c.fillStyle = '#1f1613';
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = '#2a1e19';
    for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 128) c.fillRect(x + ((y / 64) % 2) * 64 + 3, y + 3, 122, 58);
    c.fillStyle = 'rgba(176,138,69,0.35)';
    c.fillRect(0, 0, 256, 3);
  });
  const facade = matte('#ffffff', { map: repeatTex(stone, 14, 3) });
  // The main hall and card room. Its front is built separately, around the doorway.
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  mesh(box(40.7, 9, 43.8), [facade, facade, facade, facade, hidden, facade], 0, 4.5, -6.55, g);
  const doorW = DOOR_SIZES.casino.w;
  const doorH = DOOR_SIZES.casino.h;
  const sideW = (40.7 - doorW) / 2;
  for (const sx of [-1, 1]) mesh(plane(sideW, 9), matte('#ffffff', { map: repeatTex(stone, sideW / 2.9, 3) }), sx * (doorW / 2 + sideW / 2), 4.5, 15.35, g);
  mesh(plane(doorW, 9 - doorH), matte('#ffffff', { map: repeatTex(stone, doorW / 2.9, (9 - doorH) / 3) }), 0, doorH + (9 - doorH) / 2, 15.35, g);
  // The step through the wall, so there is no gap in the floor.
  const sill = mesh(plane(doorW, 0.5), matte('#3a1c10'), 0, 0.012, 15.15, g);
  sill.rotation.x = -Math.PI / 2;
  mesh(box(11.4, 5.2, 14.8), matte('#ffffff', { map: repeatTex(stone, 4, 2) }), 25.7, 2.6, 12, g); // dice parlour
  mesh(box(7.7, 6, 21.1), matte('#3a2a26'), 24.2, 3, -6, g); // the alley block
  mesh(box(40.9, 0.4, 0.5), brass, 0, 9.1, 15.4, g);
  // Gold light strips up the front.
  for (const x of [-15, -8, 8, 15]) {
    mesh(box(0.25, 8.4, 0.12), flat('#e0b25a'), x, 4.4, 15.42, g);
    const glow = glowPlane('#ffb040', 2.2, 9, 0.45);
    glow.position.set(x, 4.4, 15.5);
    g.add(glow);
  }
  // The marquee.
  const marquee = canvasTexture(1024, 280, (c) => {
    c.fillStyle = '#120a08';
    c.fillRect(0, 0, 1024, 280);
    c.strokeStyle = '#b08a45';
    c.lineWidth = 8;
    c.strokeRect(6, 6, 1012, 268);
    c.shadowColor = '#ffb040';
    c.shadowBlur = 14;
    c.fillStyle = '#ffe6ad';
    for (let x = 40; x <= 984; x += 46) for (const y of [28, 252]) {
      c.beginPath();
      c.arc(x, y, 8, 0, Math.PI * 2);
      c.fill();
    }
    const gold = c.createLinearGradient(0, 70, 0, 220);
    gold.addColorStop(0, '#ffe7a8');
    gold.addColorStop(0.6, '#e0b25a');
    gold.addColorStop(1, '#a87a2c');
    c.font = `italic 700 132px ${SERIF}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = '#ff9a2e';
    c.shadowBlur = 34;
    c.fillStyle = gold;
    c.fillText(GAME_NAME, 512, 142, 900);
  });
  const signGlow = glowPlane('#ff8a3c', 14, 5, 0.55);
  signGlow.position.set(0, 6.4, 15.5);
  g.add(signGlow);
  mesh(plane(10, 2.75), flat('#ffffff', { map: marquee }), 0, 6.4, 15.6, g);
  // Awning, doors, ropes, little trees.
  mesh(box(6.4, 0.25, 3.4), matte('#7a1420'), 0, 3.7, 17.05, g).castShadow = true;
  mesh(box(6.5, 0.08, 0.08), brass, 0, 3.58, 18.76, g);
  for (const x of [-3.1, 3.1]) mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 8), brass, x, 1.8, 18.7, g);
  // A brass frame round the doorway (the doors themselves swing: see doors.ts).
  for (const sx of [-1, 1]) mesh(box(0.16, doorH + 0.16, 0.2), brass, sx * (doorW / 2 + 0.08), (doorH + 0.16) / 2, 15.42, g);
  mesh(box(doorW + 0.32, 0.16, 0.2), brass, 0, doorH + 0.08, 15.42, g);
  for (const sx of [-1, 1]) {
    const glow = glowPlane('#ffb766', 2.2, 4.5, 0.32);
    glow.position.set(sx * (doorW / 2 + 1.1), 1.8, 15.6);
    g.add(glow);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = 16.4 + i * 1.4;
      mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.9, 10), brass, side * 1.7, 0.45, z, g);
      mesh(new THREE.SphereGeometry(0.08, 10, 8), brass, side * 1.7, 0.95, z, g);
      if (i < 3) {
        const rope = mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 6), matte('#a3161e'), side * 1.7, 0.75, z + 0.7, g);
        rope.rotation.x = Math.PI / 2;
      }
    }
    const tub = mesh(new THREE.CylinderGeometry(0.4, 0.32, 0.6, 14), brass, side * 4.3, 0.3, 16.1, g);
    tub.castShadow = true;
    mesh(new THREE.ConeGeometry(0.55, 1.9, 12), toon('#2f7a47', { emissive: '#0d2414' }), side * 4.3, 1.55, 16.1, g).castShadow = true;
  }
  // The doorman, who decides whether you are coming in.
  const doorman = buildCharacter('', 'guard');
  doorman.position.set(2.6, 0, 16.6);
  doorman.rotation.y = 0;
  const dp = partsOf(doorman);
  dp.hands[0].position.set(0.15, 0.8, 0.36);
  dp.hands[1].position.set(-0.15, 0.78, 0.39);
  updateArms(dp);
  g.add(doorman);
  // A sign by the door.
  const plaque = new TextSprite(0.24);
  plaque.set('Members only · ask the doorman', '#2a1a08', '#c9a24a');
  plaque.sprite.position.set(CASINO_DOOR.x - 2.7, 1.6, 16.3);
  g.add(plaque.sprite);

  // The dice parlour's own neon, round the side.
  const diceNeon = canvasTexture(512, 160, (c) => {
    c.fillStyle = '#120812';
    c.fillRect(0, 0, 512, 160);
    c.font = `italic 700 110px ${SERIF}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = '#ff4fa0';
    c.shadowBlur = 26;
    c.fillStyle = '#ffd0ea';
    c.fillText('Dice', 256, 84);
  });
  mesh(plane(3.4, 1.06), flat('#ffffff', { map: diceNeon }), 25.7, 3.4, 19.45, g);
  const pink = glowPlane('#ff4fa0', 6, 3, 0.5);
  pink.position.set(25.7, 3.4, 19.42);
  g.add(pink);

  // ---- the apartment building across the road ----
  // The upper floors: the windowed face (-z) looks at the casino.
  const winTex = windowsTexture(21, 20, 4);
  const plain = matte('#3a2420');
  const roof = matte('#2a1a16');
  mesh(box(52, 14.4, 14), [plain, plain, roof, roof, plain, matte('#ffffff', { map: winTex, emissive: '#ffffff', emissiveMap: winTex, emissiveIntensity: 0.55 })], 0, 3.6 + 7.2, 51.3, g);
  // Ground floor: a dark band with the front door in it (the corridor runs back from there).
  const bw = DOOR_SIZES.building.w;
  const bh = DOOR_SIZES.building.h;
  const band = matte('#24140f');
  const bandSide = (52.2 - bw) / 2;
  for (const sx of [-1, 1]) mesh(box(bandSide, 3.6, 0.4), band, sx * (bw / 2 + bandSide / 2), 1.8, 44.2, g);
  mesh(box(bw, 3.6 - bh, 0.4), band, 0, bh + (3.6 - bh) / 2, 44.2, g);
  for (const sx of [-1, 1]) mesh(box(0.1, bh + 0.1, 0.46), matte('#1d3a2a'), sx * (bw / 2 + 0.05), (bh + 0.1) / 2, 44.2, g);
  mesh(box(3.4, 0.2, 1.6), matte('#1d4a30'), 0, 3.1, 43.3, g);
  mesh(box(2.2, 0.05, 1.2), matte('#6a6660'), 0, 0.025, 43.4, g);
  const nameSign = new TextSprite(0.3);
  nameSign.set('LUCKY ARMS · apartments', '#f6ead2', 'rgba(20,36,26,0.95)');
  nameSign.sprite.position.set(0, 3.55, 43.9);
  g.add(nameSign.sprite);
  const bulb = glowSprite('#ffdf9a', 1.6, 0.9);
  bulb.position.set(0, 2.9, 43.6);
  g.add(bulb);
  // Fire escapes zig-zagging up the front.
  const iron = matte('#141414');
  for (const fx of [-16, 16]) {
    for (let f = 1; f < 5; f++) {
      const y = f * 3.4 + 0.4;
      mesh(box(4, 0.06, 1.1), iron, fx, y, 43.7, g);
      mesh(box(4, 0.9, 0.04), iron, fx, y + 0.45, 43.15, g);
      const ladder = mesh(box(0.08, 3.6, 0.08), iron, fx + (f % 2 ? 1.6 : -1.6), y - 1.7, 43.5, g);
      ladder.rotation.z = f % 2 ? 0.5 : -0.5;
    }
  }

  // ---- the neighbours: dark buildings either side, a few lights on ----
  const side = (x: number, z: number, w: number, d: number, h: number, seed: number) => {
    const t = windowsTexture(seed, Math.max(2, Math.round(w / 2.6)), Math.max(2, Math.round(h / 3.4)));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const lit = matte('#ffffff', { map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.5 });
    const plain = matte('#2a1c1a');
    mesh(box(w, h, d), [lit, lit, plain, plain, lit, lit], x, h / 2, z, g);
  };
  side(-40.5, 2, 40, 26, 12, 31);
  side(46, 0, 28, 34, 10, 32);
  side(-43, 51.3, 34, 14, 14, 33);
  side(43, 51.3, 34, 14, 11, 34);

  // ---- street furniture ----
  const post = matte('#1c1c20');
  const lampLights: [number, number][] = [
    [-15, 21],
    [15, 21],
    [-15, 43],
    [15, 43],
  ];
  for (const l of DECOR.streetLamps) {
    mesh(new THREE.CylinderGeometry(0.07, 0.1, 4.8, 10), post, l.x, 2.4, l.z, g).castShadow = true;
    const toRoad = l.z < 30 ? 1 : -1;
    mesh(box(0.08, 0.08, 1.2), post, l.x, 4.75, l.z + toRoad * 0.6, g);
    mesh(new THREE.ConeGeometry(0.32, 0.3, 14, 1, true), post, l.x, 4.65, l.z + toRoad * 1.15, g);
    const glow = glowSprite('#ffb45a', 2.6, 0.85);
    glow.position.set(l.x, 4.45, l.z + toRoad * 1.15);
    g.add(glow);
    const pool = mesh(new THREE.CircleGeometry(2.6, 24), flat('#ffb45a', { transparent: true, opacity: 0.1, depthWrite: false }), l.x, 0.03, l.z + toRoad * 1.15, g);
    pool.rotation.x = -Math.PI / 2;
    if (lampLights.some(([x, z]) => x === l.x && z === l.z)) {
      const light = new THREE.PointLight('#ffb45a', 34, 0, 2);
      light.position.set(l.x, 4.3, l.z + toRoad * 1.15);
      g.add(light);
    }
  }
  const marqueeLight = new THREE.PointLight('#ffc070', 40, 0, 2);
  marqueeLight.position.set(0, 4.2, 18.5);
  g.add(marqueeLight);
  const doorLight = new THREE.PointLight('#ffdf9a', 12, 0, 2);
  doorLight.position.set(0, 2.8, 42.8);
  g.add(doorLight);

  for (const c of DECOR.cars) {
    const car = new THREE.Group();
    car.position.set(c.x, 0, c.z);
    car.rotation.y = c.rot;
    const paint = toonBright(c.color, 0.12);
    mesh(box(4, 0.75, 1.9), paint, 0, 0.6, 0, car).castShadow = true;
    mesh(box(2.2, 0.65, 1.7), paint, -0.2, 1.28, 0, car);
    const glass = flat('#1a2230');
    for (const z of [-0.86, 0.86]) mesh(box(1.9, 0.48, 0.02), glass, -0.2, 1.3, z, car);
    for (const x of [-1.31, 0.91]) mesh(box(0.02, 0.48, 1.5), glass, x, 1.3, 0, car);
    const tyre = matte('#111');
    for (const x of [-1.3, 1.3]) for (const z of [-0.88, 0.88]) {
      const w = mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16), tyre, x, 0.36, z, car);
      w.rotation.x = Math.PI / 2;
    }
    for (const z of [-0.6, 0.6]) {
      const hl = glowSprite('#fff0c0', 0.5, 0.6);
      hl.position.set(2.02, 0.7, z);
      car.add(hl);
      mesh(box(0.04, 0.14, 0.3), flat('#ff3030'), -2.01, 0.75, z, car);
    }
    if (c.color === '#ffd34e') {
      mesh(box(0.6, 0.22, 0.3), flat('#fff4c8'), -0.2, 1.72, 0, car);
    }
    g.add(car);
  }
  // A hydrant, a bin, a bench, a manhole that steams.
  mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.7, 12), toonBright('#c8263b', 0.1), 6, 0.35, 22.2, g);
  mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.9, 14), matte('#2a3a2e'), -6.5, 0.45, 22.3, g);
  const bench = new THREE.Group();
  bench.position.set(-9, 0, 42.2);
  mesh(box(2, 0.08, 0.5), matte('#5a3c22'), 0, 0.48, 0, bench);
  mesh(box(2, 0.45, 0.06), matte('#5a3c22'), 0, 0.78, 0.24, bench);
  for (const x of [-0.85, 0.85]) mesh(box(0.08, 0.48, 0.5), post, x, 0.24, 0, bench);
  g.add(bench);
  const manhole = mesh(new THREE.CircleGeometry(0.45, 18), matte('#1a1a1c'), -2.5, 0.012, 30.5, g);
  manhole.rotation.x = -Math.PI / 2;
  const steam: THREE.Sprite[] = [];
  for (let i = 0; i < 6; i++) {
    const s = glowSprite('#c8d0e0', 1.4, 0.12);
    (s.material as THREE.SpriteMaterial).blending = THREE.NormalBlending;
    g.add(s);
    steam.push(s);
  }
  // Road closed at both ends: this is as far as you go.
  for (const x of [-40.3, 40.3]) {
    for (let z = 20.5; z < 44; z += 2.6) {
      const bar = new THREE.Group();
      bar.position.set(x, 0, z);
      const stripes = canvasTexture(128, 32, (c) => {
        for (let i = 0; i < 8; i++) {
          c.fillStyle = i % 2 ? '#f2f2f2' : '#d83a2a';
          c.beginPath();
          c.moveTo(i * 16, 0);
          c.lineTo(i * 16 + 16, 0);
          c.lineTo(i * 16, 32);
          c.lineTo(i * 16 - 16, 32);
          c.fill();
        }
      });
      mesh(box(0.1, 0.3, 2.2), matte('#ffffff', { map: stripes }), 0, 0.9, 0, bar);
      for (const dz of [-1, 1]) mesh(box(0.08, 1, 0.08), matte('#bbb'), 0, 0.5, dz, bar);
      g.add(bar);
    }
  }

  // ---- the night sky ----
  const stars = new THREE.BufferGeometry();
  const rnd = seeded(77);
  const pts: number[] = [];
  for (let i = 0; i < 500; i++) {
    const a = rnd() * Math.PI * 2;
    const e = 0.15 + rnd() * 1.2;
    pts.push(Math.cos(a) * Math.cos(e) * 120, 20 + Math.sin(e) * 100, Math.sin(a) * Math.cos(e) * 120);
  }
  stars.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: '#c8d4ff', size: 0.6, fog: false })));
  const moon = glowSprite('#dfe6ff', 18, 0.9);
  (moon.material as THREE.SpriteMaterial).fog = false;
  moon.position.set(-50, 70, 90);
  g.add(moon);

  return (dt: number, time: number) => {
    steam.forEach((s, i) => {
      const t = (time * 0.35 + i / steam.length) % 1;
      s.position.set(-2.5 + Math.sin(time + i) * 0.3, 0.2 + t * 3, 30.5 + t * 0.6);
      s.scale.setScalar(0.8 + t * 2.2);
      (s.material as THREE.SpriteMaterial).opacity = 0.16 * (1 - t);
    });
    void dt;
  };
}

// ---- the hallway in the apartment building -------------------------------------------

/**
 * A flat wall with doorways cut in it. The wall runs along `axis` from `from` to `to` at the
 * fixed coordinate `at`, and faces `facing` (the side you see it from). Holes are [from, to, height].
 */
function holedWall(g: THREE.Object3D, mat: (w: number, h: number) => THREE.Material, axis: 'x' | 'z', at: number, from: number, to: number, h: number, facing: 1 | -1, holes: [number, number, number][]) {
  const sorted = [...holes].sort((a, b) => a[0] - b[0]);
  const pieces: [number, number, number, number][] = []; // along-from, along-to, y-from, y-to
  let cursor = from;
  for (const [a, b, hh] of sorted) {
    if (a > cursor) pieces.push([cursor, a, 0, h]);
    if (hh < h) pieces.push([a, b, hh, h]);
    cursor = b;
  }
  if (cursor < to) pieces.push([cursor, to, 0, h]);
  for (const [a, b, y0, y1] of pieces) {
    const w = b - a;
    const m = mesh(plane(w, y1 - y0), mat(w, y1 - y0), 0, (y0 + y1) / 2, 0, g);
    if (axis === 'x') {
      // A wall along x, at z = at, facing +z or -z.
      m.position.x = (a + b) / 2;
      m.position.z = at;
      m.rotation.y = facing > 0 ? 0 : Math.PI;
    } else {
      m.position.x = at;
      m.position.z = (a + b) / 2;
      m.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }
}

function buildHallway(g: THREE.Group) {
  const { x0, x1, z0, z1, height: h } = HALLWAY;
  const wide = x1 - x0;
  const long = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const lino = canvasTexture(128, 128, (c) => {
    const rnd = seeded(3);
    c.fillStyle = '#b8a888';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#6a5a48';
    c.fillRect(0, 0, 64, 64);
    c.fillRect(64, 64, 64, 64);
    for (let i = 0; i < 300; i++) {
      c.fillStyle = `rgba(40,30,20,${rnd() * 0.25})`;
      c.fillRect(rnd() * 128, rnd() * 128, 3 + rnd() * 6, 2);
    }
  });
  const floor = mesh(plane(wide, long), matte('#ffffff', { map: repeatTex(lino, wide / 1.2, long / 1.2) }), cx, 0, cz, g);
  floor.rotation.x = -Math.PI / 2;
  const ceil = mesh(plane(wide, long), matte('#a8a490'), cx, h, cz, g);
  ceil.rotation.x = Math.PI / 2;
  // The doormat-sized gap under the front door, between pavement and lino.
  const step = mesh(plane(DOOR_SIZES.building.w, 0.9), matte('#3a3430'), 0, 0.005, 44.15, g);
  step.rotation.x = -Math.PI / 2;
  const paint = canvasTexture(256, 256, (c) => {
    const rnd = seeded(12);
    c.fillStyle = '#c8bc8a';
    c.fillRect(0, 0, 256, 128);
    c.fillStyle = '#5a7a5a';
    c.fillRect(0, 128, 256, 128);
    c.fillStyle = '#3a2a1a';
    c.fillRect(0, 124, 256, 6);
    for (let i = 0; i < 40; i++) {
      c.fillStyle = `rgba(90,70,40,${0.1 + rnd() * 0.2})`;
      c.beginPath();
      c.ellipse(rnd() * 256, rnd() * 120, 6 + rnd() * 20, 4 + rnd() * 30, 0, 0, Math.PI * 2);
      c.fill();
    }
  });
  const wallMat = (w: number, wh: number) => matte('#ffffff', { map: repeatTex(paint, w / 2.5, wh / h) });
  const aw = DOOR_SIZES.apt.w;
  const doorsOn = (left: boolean) =>
    Array.from({ length: APT_SLOTS }, (_, s) => s)
      .filter((s) => s < 4 === left)
      .map((s): [number, number, number] => [aptDoor(s).z - aw / 2, aptDoor(s).z + aw / 2, DOOR_SIZES.apt.h]);
  // The long walls, with a doorway to each flat; the front wall with the street door; the far end.
  holedWall(g, wallMat, 'z', x0, z0, z1, h, 1, doorsOn(true));
  holedWall(g, wallMat, 'z', x1, z0, z1, h, -1, doorsOn(false));
  const bw = DOOR_SIZES.building.w;
  holedWall(g, wallMat, 'x', z0, x0, x1, h, 1, [[-bw / 2, bw / 2, DOOR_SIZES.building.h]]);
  holedWall(g, wallMat, 'x', z1, x0, x1, h, -1, []);

  // Flickering strip lights, all the way down.
  for (let z = z0 + 3; z < z1; z += 6.5) {
    mesh(box(0.2, 0.08, 1.2), matte('#ddd'), cx, h - 0.04, z, g);
    mesh(box(0.1, 0.04, 1.1), flat('#eef8e0'), cx, h - 0.1, z, g);
  }
  const tube = new THREE.PointLight('#e0f0d0', 12, 0, 2);
  tube.position.set(cx, h - 0.3, z0 + 3);
  g.add(tube);
  const tube2 = new THREE.PointLight('#e0f0d0', 10, 0, 2);
  tube2.position.set(cx, h - 0.3, z0 + 16);
  g.add(tube2);
  const tube3 = new THREE.PointLight('#e0f0d0', 8, 0, 2);
  tube3.position.set(cx, h - 0.3, z1 - 6);
  g.add(tube3);

  // The way out, over the front door.
  const exitSign = new TextSprite(0.18);
  exitSign.set('EXIT · street', '#fff', 'rgba(170,30,20,0.95)');
  exitSign.sprite.position.set(0, DOOR_SIZES.building.h + 0.22, z0 + 0.06);
  g.add(exitSign.sprite);

  // Eight doorways, with frames, numbers and names (the doors themselves are in doors.ts).
  const names: TextSprite[] = [];
  const frame = matte('#3a2416');
  for (let s = 0; s < APT_SLOTS; s++) {
    const d = aptDoor(s);
    const into = s < 4 ? 1 : -1; // towards the middle of the corridor
    for (const sz of [-1, 1]) mesh(box(0.06, DOOR_SIZES.apt.h + 0.08, 0.08), frame, d.x + into * 0.03, (DOOR_SIZES.apt.h + 0.08) / 2, d.z + sz * (aw / 2 + 0.04), g);
    mesh(box(0.06, 0.08, aw + 0.16), frame, d.x + into * 0.03, DOOR_SIZES.apt.h + 0.04, d.z, g);
    const num = new TextSprite(0.16);
    num.set(`${Math.floor(s / 4) + 1}${'ABCD'[s % 4]}`, '#2a1a08', '#c9a24a');
    num.sprite.position.set(d.x + into * 0.08, DOOR_SIZES.apt.h + 0.28, d.z);
    g.add(num.sprite);
    const n = new TextSprite(0.15);
    n.sprite.position.set(d.x + into * 0.12, DOOR_SIZES.apt.h + 0.58, d.z);
    g.add(n.sprite);
    names.push(n);
    // A doormat.
    const mat = mesh(plane(0.5, 0.9), matte('#5a2a1a'), d.x + into * 0.4, 0.006, d.z, g);
    mat.rotation.x = -Math.PI / 2;
  }
  // A radiator, a bin bag, a sad plant, a wall of mailboxes by the front door.
  mesh(box(0.12, 0.6, 1.2), matte('#9a9a92'), x1 - 0.08, 0.45, z1 - 1.4, g);
  mesh(new THREE.SphereGeometry(0.3, 12, 10), matte('#111'), x0 + 0.4, 0.25, z1 - 0.6, g).scale.y = 0.8;
  mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.35, 10), matte('#8a4a2a'), x1 - 0.35, 0.18, z0 + 0.4, g);
  mesh(new THREE.ConeGeometry(0.2, 0.5, 6), toon('#5a7a3a'), x1 - 0.35, 0.6, z0 + 0.4, g).rotation.z = 0.3;
  mesh(box(0.08, 0.9, 1.4), matte('#8a8a7a'), x0 + 0.04, 1.4, z0 + 1.2, g);

  return {
    setNames(info: LobbyInfo) {
      for (let s = 0; s < APT_SLOTS; s++) {
        const m = info.members.find((x) => x.slot === s);
        if (m) names[s].set(m.name, m.color === '#f4f0e6' ? '#2a1a08' : '#fff', m.color);
        else names[s].set('');
      }
    },
    anim(time: number) {
      // Every few seconds the strip light stutters.
      const stutter = Math.sin(time * 1.7) > 0.97 ? 0.2 + Math.random() * 0.5 : 1;
      tube.intensity = 12 * stutter;
    },
  };
}

// ---- an apartment -------------------------------------------------------------------

/**
 * A flat's bathroom: a little room of its own in the far-left corner, with a doorway into the
 * flat (the door stands open against the inside wall). Tiled floor and walls, a vanity with a
 * basin and a mirror, a towel rail, its own light. The toilet itself is placed by the flat.
 * In the penthouse: marble and brass.
 */
function buildBathroom(
  g: THREE.Group,
  b: { x0: number; z0: number; x1: number; z1: number; door: { x0: number; x1: number }; wall: number },
  sink: { x: number; z: number },
  h: number,
  lux: boolean,
) {
  const tiles = canvasTexture(128, 128, (c) => {
    c.fillStyle = lux ? '#d8d2c8' : '#9fb8c0';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = lux ? '#f4f0ea' : '#e8f0f2';
    for (let y = 0; y < 128; y += 32) for (let x = 0; x < 128; x += 32) c.fillRect(x + 1, y + 1, 30, 30);
    if (lux) {
      // Grey veins through the marble.
      c.strokeStyle = 'rgba(120, 120, 130, 0.35)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(0, 30);
      c.bezierCurveTo(40, 50, 70, 10, 128, 60);
      c.moveTo(10, 128);
      c.bezierCurveTo(50, 90, 90, 120, 128, 96);
      c.stroke();
    }
  });
  const tileMat = (len: number, ht: number) => {
    const t = tiles.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(len / 0.6, ht / 0.6);
    t.needsUpdate = true;
    return matte('#ffffff', { map: t });
  };
  // The living room side of the bathroom walls matches the rest of the flat.
  const roomSide = matte(lux ? '#d6cbb6' : '#a89a72');
  const t = b.wall;
  const doorH = 2.1;
  // Box faces: +x, -x, +y, -y, +z, -z. The bathroom is on the -x side of its side wall, and the
  // -z side of its front wall.
  const sideLen = b.z1 - b.z0 + t;
  const side = new THREE.Mesh(new THREE.BoxGeometry(t, h, sideLen), [roomSide, tileMat(sideLen, h), roomSide, roomSide, roomSide, roomSide]);
  side.position.set(b.x1, h / 2, (b.z0 + b.z1 + t) / 2);
  g.add(side);
  const front = (x0: number, x1: number, y0: number, y1: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, t), [roomSide, roomSide, roomSide, roomSide, roomSide, tileMat(x1 - x0, y1 - y0)]);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, b.z1);
    g.add(m);
  };
  front(b.x0, b.door.x0, 0, h);
  front(b.door.x1, b.x1 + t / 2, 0, h);
  front(b.door.x0, b.door.x1, doorH, h); // over the doorway
  const frameMat = matte(lux ? '#f4efe6' : '#5a3a22');
  for (const x of [b.door.x0, b.door.x1]) mesh(box(0.06, doorH, t + 0.04), frameMat, x, doorH / 2, b.z1, g);
  mesh(box(b.door.x1 - b.door.x0 + 0.12, 0.06, t + 0.04), frameMat, (b.door.x0 + b.door.x1) / 2, doorH, b.z1, g);
  // The door, open, back against the inside of the side wall.
  const lw = b.door.x1 - b.door.x0 - 0.04;
  const hinge = new THREE.Group();
  hinge.position.set(b.door.x1 - 0.03, 0, b.z1 - t / 2);
  hinge.rotation.y = -Math.PI / 2 + 0.12;
  mesh(box(lw, doorH - 0.04, 0.04), matte(lux ? '#f4efe6' : '#6a4a2e'), -lw / 2, (doorH - 0.04) / 2, 0, hinge);
  mesh(new THREE.SphereGeometry(0.035, 8, 6), matte('#b08a45'), -lw + 0.08, 1.0, 0.04, hinge);
  g.add(hinge);

  // Floor: small tiles (or marble).
  const floor = mesh(plane(b.x1 - b.x0, b.z1 - b.z0), tileMat((b.x1 - b.x0) * 1.6, (b.z1 - b.z0) * 1.6), (b.x0 + b.x1) / 2, 0.012, (b.z0 + b.z1) / 2, g);
  floor.rotation.x = -Math.PI / 2;
  // The bathroom's own two inside walls (back and left) get tiles too.
  const back = mesh(plane(b.x1 - b.x0, h), tileMat(b.x1 - b.x0, h), (b.x0 + b.x1) / 2, h / 2, b.z0 + 0.01, g);
  back.renderOrder = 1;
  const left = mesh(plane(b.z1 - b.z0, h), tileMat(b.z1 - b.z0, h), b.x0 + 0.01, h / 2, (b.z0 + b.z1) / 2, g);
  left.rotation.y = Math.PI / 2;

  // The vanity: a cabinet, a basin, a tap, and a mirror over it.
  const metal = matte(lux ? '#c9a24a' : '#b8bcc0', { emissive: lux ? '#3a2a08' : '#1a1c1e' });
  mesh(box(0.54, 0.78, 0.42), matte(lux ? '#efe9e0' : '#f2f0ea'), sink.x, 0.39, sink.z, g).castShadow = true;
  const basin = mesh(new THREE.SphereGeometry(0.18, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), matte('#fbfbf8', { side: THREE.DoubleSide }), sink.x, 0.83, sink.z + 0.02, g);
  basin.rotation.x = Math.PI;
  basin.scale.y = 0.45;
  mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.2, 8), metal, sink.x, 0.9, b.z0 + 0.06, g);
  mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 8), metal, sink.x, 0.99, b.z0 + 0.11, g).rotation.x = Math.PI / 2;
  const glass = makeMirror(0.5, 0.65);
  glass.position.set(sink.x, 1.45, b.z0 + 0.03);
  g.add(glass);
  if (lux) mesh(box(0.56, 0.71, 0.012), metal, sink.x, 1.45, b.z0 + 0.016, g); // the frame, behind the glass
  // A towel on a rail, on the inside of the side wall.
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 8), metal, b.x1 - t / 2 - 0.06, 1.15, b.z0 + 0.75, g).rotation.x = Math.PI / 2;
  mesh(box(0.04, 0.5, 0.42), toon(lux ? '#f4efe6' : '#4a8ac0'), b.x1 - t / 2 - 0.08, 0.92, b.z0 + 0.75, g);
  // A light in the ceiling.
  mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16), flat('#f8fbff'), (b.x0 + b.x1) / 2, h - 0.01, (b.z0 + b.z1) / 2, g);
  const light = new THREE.PointLight(lux ? '#fff0d8' : '#eef6ff', lux ? 5 : 4, 0, 2);
  light.position.set((b.x0 + b.x1) / 2, h - 0.3, (b.z0 + b.z1) / 2);
  g.add(light);
}

/**
 * The flat for a slot. Level 1 is a grim little studio; bigger levels are bigger rooms with
 * a bit more in them. `home` is what the owner has bought from the shop for it.
 */
function buildApartment(slot: number, level: number, home: readonly string[] = []) {
  const has = (id: string) => home.includes(id);
  // Built in the flat's own coordinates (door in the z = d wall), then turned into place.
  const g = new THREE.Group();
  const frame = aptFrame(slot, level);
  g.position.set(frame.x, 0, frame.z);
  g.rotation.y = frame.rot;
  const { w, d, h } = aptSize(level);
  const X = (x: number) => x;
  const Z = (z: number) => z;
  /** The penthouse: a different world from the studio. */
  const lux = level >= 3;
  /** Where the fridge, toilet, TV and (in bigger flats) the bathroom are. */
  const L = aptLayout(level);
  const fz = L.fridge.z;
  const tz = L.tvZ;

  const parquet = canvasTexture(256, 256, (c) => {
    // Light oak planks, staggered, each a slightly different shade.
    const rnd = seeded(70 + slot);
    for (let y = 0; y < 256; y += 32) {
      for (let x = -((y / 32) % 2) * 64; x < 256; x += 128) {
        const v = 150 + rnd() * 40;
        c.fillStyle = `rgb(${v + 30}, ${v - 5}, ${v - 55})`;
        c.fillRect(x, y, 127, 31);
        c.fillStyle = 'rgba(90, 60, 30, 0.12)';
        for (let i = 0; i < 4; i++) c.fillRect(x + rnd() * 120, y + 4 + rnd() * 22, 30 + rnd() * 60, 1);
      }
    }
  });
  const carpet = canvasTexture(256, 256, (c) => {
    const rnd = seeded(40 + slot);
    c.fillStyle = '#5a4a3a';
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2000; i++) {
      c.fillStyle = `rgba(${rnd() > 0.5 ? '90,74,58' : '50,40,30'},0.5)`;
      c.fillRect(rnd() * 256, rnd() * 256, 2, 2);
    }
    for (let i = 0; i < 4; i++) {
      c.fillStyle = 'rgba(30,22,14,0.35)';
      c.beginPath();
      c.ellipse(rnd() * 256, rnd() * 256, 20 + rnd() * 30, 12 + rnd() * 20, rnd() * 3, 0, Math.PI * 2);
      c.fill();
    }
  });
  const floor = mesh(plane(w, d), matte('#ffffff', { map: lux ? repeatTex(parquet, w / 1.3, d / 1.3) : repeatTex(carpet, w / 2, d / 2) }), X(w / 2), 0, Z(d / 2), g);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const ceiling = canvasTexture(128, 128, (c) => {
    c.fillStyle = '#b8b0a0';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = 'rgba(120,90,50,0.45)';
    c.beginPath();
    c.ellipse(80, 50, 30, 22, 0.4, 0, Math.PI * 2);
    c.fill(); // a water stain
  });
  const ceil = mesh(plane(w, d), lux ? matte('#efe9df') : matte('#ffffff', { map: ceiling }), X(w / 2), h, Z(d / 2), g);
  ceil.rotation.x = Math.PI / 2;

  // Penthouse walls: warm panelling with a moulded frame every 90 cm.
  const panels = canvasTexture(256, 256, (c) => {
    c.fillStyle = '#d6cbb6';
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = 'rgba(120, 100, 70, 0.35)';
    c.lineWidth = 4;
    c.strokeRect(18, 22, 220, 212);
    c.strokeStyle = 'rgba(255, 250, 240, 0.5)';
    c.lineWidth = 2;
    c.strokeRect(24, 28, 208, 200);
  });

  const paper = canvasTexture(256, 256, (c) => {
    const rnd = seeded(60 + slot);
    c.fillStyle = '#a89a72';
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = 'rgba(120,80,60,0.35)';
    for (let y = 16; y < 256; y += 40) for (let x = 16; x < 256; x += 40) {
      c.beginPath();
      c.arc(x + ((y / 40) % 2) * 20, y, 6, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 12; i++) {
      c.fillStyle = `rgba(60,44,26,${0.15 + rnd() * 0.2})`;
      c.fillRect(rnd() * 256, rnd() * 256, 3 + rnd() * 6, 20 + rnd() * 60); // drips
    }
    c.fillStyle = '#7a6a4a';
    c.beginPath();
    c.moveTo(200, 0);
    c.lineTo(230, 40);
    c.lineTo(214, 46);
    c.closePath();
    c.fill(); // a peeling corner
  });
  const wallMat = (len: number) => (lux ? matte('#ffffff', { map: repeatTex(panels, len / 0.9, 1) }) : matte('#ffffff', { map: repeatTex(paper, len / 1.6, h / 1.6) }));
  if (lux) {
    // The window wall: floor-to-ceiling glass in the middle, onto the city at night.
    const win = { x0: 2.3, x1: 5.1, y0: 0.15, y1: h - 0.25 };
    for (const [x0, x1] of [[0, win.x0], [win.x1, w]]) mesh(plane(x1 - x0, h), wallMat(x1 - x0), X((x0 + x1) / 2), h / 2, Z(0), g);
    mesh(plane(win.x1 - win.x0, win.y0), wallMat(win.x1 - win.x0), X((win.x0 + win.x1) / 2), win.y0 / 2, Z(0), g);
    mesh(plane(win.x1 - win.x0, h - win.y1), wallMat(win.x1 - win.x0), X((win.x0 + win.x1) / 2), (win.y1 + h) / 2, Z(0), g);
    const skyline = canvasTexture(512, 320, (c) => {
      const rnd = seeded(500 + slot);
      const sky = c.createLinearGradient(0, 0, 0, 320);
      sky.addColorStop(0, '#0a0e2a');
      sky.addColorStop(0.65, '#2a1a4a');
      sky.addColorStop(1, '#6a2a5a');
      c.fillStyle = sky;
      c.fillRect(0, 0, 512, 320);
      c.fillStyle = 'rgba(255, 255, 240, 0.8)';
      for (let i = 0; i < 60; i++) c.fillRect(rnd() * 512, rnd() * 150, 1.5, 1.5); // stars
      c.fillStyle = '#f4efd8';
      c.beginPath();
      c.arc(420, 60, 22, 0, Math.PI * 2);
      c.fill(); // the moon
      // Two rows of towers, the far ones paler, with lit windows.
      for (const [base, shade, tall] of [[300, '#1a1830', 150], [320, '#0c0a18', 210]] as const) {
        let x = -10;
        while (x < 520) {
          const bw = 30 + rnd() * 50;
          const bh = 60 + rnd() * tall;
          c.fillStyle = shade;
          c.fillRect(x, base - bh, bw, bh + 20);
          for (let wy = base - bh + 8; wy < base - 6; wy += 12) {
            for (let wx = x + 5; wx < x + bw - 6; wx += 9) {
              if (rnd() < 0.35) {
                c.fillStyle = rnd() < 0.8 ? 'rgba(255, 214, 140, 0.9)' : 'rgba(160, 220, 255, 0.85)';
                c.fillRect(wx, wy, 4, 6);
              }
            }
          }
          x += bw + 4;
        }
      }
      // The casino's glow at street level.
      const glow = c.createLinearGradient(0, 250, 0, 320);
      glow.addColorStop(0, 'rgba(255, 80, 160, 0)');
      glow.addColorStop(1, 'rgba(255, 120, 60, 0.55)');
      c.fillStyle = glow;
      c.fillRect(0, 250, 512, 70);
    });
    mesh(plane(win.x1 - win.x0, win.y1 - win.y0), flat('#ffffff', { map: skyline }), X((win.x0 + win.x1) / 2), (win.y0 + win.y1) / 2, Z(-0.02), g);
    // Black steel frame and mullions.
    const steel = matte('#15161a');
    for (const x of [win.x0, (win.x0 * 2 + win.x1) / 3, (win.x0 + win.x1 * 2) / 3, win.x1]) mesh(box(0.06, win.y1 - win.y0, 0.06), steel, X(x), (win.y0 + win.y1) / 2, Z(0.02), g);
    for (const y of [win.y0, win.y1]) mesh(box(win.x1 - win.x0 + 0.06, 0.06, 0.06), steel, X((win.x0 + win.x1) / 2), y, Z(0.02), g);
    // Moonlight spilling in.
    const moon = new THREE.PointLight('#9fb4ff', 3, 0, 2);
    moon.position.set(X((win.x0 + win.x1) / 2), 2, Z(0.6));
    g.add(moon);
  } else mesh(plane(w, h), wallMat(w), X(w / 2), h / 2, Z(0), g);
  // The front wall, with the doorway out to the corridor (the door itself is in doors.ts).
  const aw = DOOR_SIZES.apt.w;
  holedWall(g, (len) => wallMat(len), 'x', d, 0, w, h, -1, [[0.9 - aw / 2, 0.9 + aw / 2, DOOR_SIZES.apt.h]]);
  const wWall = mesh(plane(d, h), wallMat(d), X(0), h / 2, Z(d / 2), g);
  wWall.rotation.y = Math.PI / 2;
  const eWall = mesh(plane(d, h), wallMat(d), X(w), h / 2, Z(d / 2), g);
  eWall.rotation.y = -Math.PI / 2;
  if (lux) {
    // White skirting all round, and a brass picture rail.
    const skirt = matte('#f4efe6');
    const rail = matte('#b08a45', { emissive: '#2a1e08' });
    for (const [len, x, z, ry] of [[w, w / 2, 0.02, 0], [d, 0.02, d / 2, Math.PI / 2], [d, w - 0.02, d / 2, Math.PI / 2]] as const) {
      mesh(box(len, 0.14, 0.03), skirt, X(x), 0.07, Z(z), g).rotation.y = ry;
      mesh(box(len, 0.03, 0.03), rail, X(x), h - 0.45, Z(z), g).rotation.y = ry;
    }
  } else mesh(box(w, 0.12, 0.03), matte('#4a3a2a'), X(w / 2), 0.06, Z(0.015), g);

  // The bed: a mattress on the floor, a lumpy duvet, one flat pillow. Or, bought from the
  // shop, an actual bed with legs and a headboard.
  const bedX = w - 1.15;
  const lift = has('bed') ? 0.32 : 0;
  if (lux) {
    // A low walnut bed with an upholstered headboard, white linen, a grey throw, four pillows,
    // and a nightstand with a lamp on the window side.
    const walnut = matte('#4a2e1c');
    mesh(box(2.25, 0.3, 1.95), walnut, X(bedX - 0.02), 0.15, Z(0.97), g).castShadow = true;
    mesh(box(0.12, 1.15, 2.05), toon('#3a4a5a'), X(w - 0.07), 0.75, Z(0.97), g); // headboard
    for (const zz of [0.45, 0.97, 1.49]) mesh(box(0.04, 0.9, 0.04), matte('#2c3844'), X(w - 0.13), 0.85, Z(zz), g); // its buttons, sort of
    mesh(box(2.1, 0.22, 1.85), matte('#f6f4ee'), X(bedX), 0.41, Z(0.97), g).castShadow = true;
    mesh(box(1.3, 0.06, 1.9), matte('#ffffff'), X(bedX - 0.35), 0.55, Z(0.97), g); // the duvet
    mesh(box(0.55, 0.07, 1.92), toon('#6a6e78'), X(bedX - 0.75), 0.58, Z(0.97), g); // a throw across the foot
    for (const zz of [0.5, 1.44]) {
      mesh(new THREE.SphereGeometry(0.3, 14, 10), matte('#fbfaf6'), X(w - 0.38), 0.62, Z(zz), g).scale.set(0.45, 0.4, 1.1);
      mesh(new THREE.SphereGeometry(0.24, 14, 10), toon('#c8a070'), X(w - 0.6), 0.62, Z(zz), g).scale.set(0.35, 0.45, 0.9);
    }
    mesh(box(0.45, 0.5, 0.42), walnut, X(w - 0.25), 0.25, Z(2.28), g).castShadow = true; // nightstand
    mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.3, 14), matte('#e8e0d0'), X(w - 0.25), 0.65, Z(2.28), g);
    mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.2, 18, 1, true), toon('#f4e2b0', { side: THREE.DoubleSide }), X(w - 0.25), 0.9, Z(2.28), g);
    const bedside = new THREE.PointLight('#ffd8a0', 3, 0, 2);
    bedside.position.set(X(w - 0.3), 0.95, Z(2.28));
    g.add(bedside);
  } else if (has('bed')) {
    const frame = matte('#6a4426');
    mesh(box(2.2, 0.16, 1.85), frame, X(bedX), 0.24, Z(0.97), g).castShadow = true;
    for (const [lx, lz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) mesh(box(0.08, 0.24, 0.08), frame, X(bedX + lx * 1.02), 0.12, Z(0.97 + lz * 0.85), g);
    mesh(box(0.1, 0.9, 1.85), frame, X(w - 0.07), 0.6, Z(0.97), g); // headboard
  }
  if (!lux) {
    mesh(box(2.1, 0.24, 1.75), matte('#d8d0b8'), X(bedX), 0.12 + lift, Z(0.97), g).castShadow = true;
    const duvet = mesh(box(1.5, 0.16, 1.7), toon(has('bed') ? '#b03a4a' : '#4a6a8a'), X(bedX - 0.25), 0.3 + lift, Z(0.98), g);
    duvet.rotation.z = has('bed') ? 0 : 0.04;
    duvet.rotation.y = has('bed') ? 0 : 0.05;
    mesh(new THREE.SphereGeometry(0.3, 12, 8), matte('#efe8d8'), X(w - 0.4), 0.32 + lift, Z(0.98), g).scale.set(0.6, 0.35, 1.2);
  }

  // A fridge, a TV on a crate, a stack of pizza boxes, a chair with a bucket (the ceiling leaks).
  // The penthouse: a steel fridge, a flat screen on the wall over a low console.
  if (lux) {
    const steel = matte('#c4c8cc', { emissive: '#1a1c20' });
    mesh(box(0.72, 1.85, 0.7), steel, X(0.37), 0.925, Z(fz), g).castShadow = true;
    for (const y of [1.25, 0.55]) mesh(box(0.03, 0.4, 0.03), matte('#5a5e64'), X(0.74), y, Z(fz + 0.25), g);
  } else {
    mesh(box(0.7, 1.3, 0.7), matte('#d8d0b0'), X(0.37), 0.65, Z(fz), g).castShadow = true;
    mesh(box(0.04, 0.3, 0.04), matte('#888'), X(0.74), 0.9, Z(fz + 0.23), g);
  }
  // The toilet: right there next to the fridge. The studio does not run to a bathroom.
  // (The penthouse does not either, but it has a frosted glass screen.)
  const loo = buildToilet(level === 1);
  loo.position.set(X(L.toilet.bowl.x), 0, Z(0.01));
  g.add(loo);
  mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.11, 12), matte('#f4f0e6'), X(L.toilet.bowl.x + (L.bath ? -0.42 : 0.47)), 0.6, Z(0.08), g).rotation.z = Math.PI / 2; // a loo roll
  if (L.bath) buildBathroom(g, L.bath, L.sink!, h, lux);
  if (lux) {
    mesh(box(0.48, 0.05, 1.0), toon('#3a4a5a'), X(0.24), 0.455, Z(tz), g); // the console's top
    mesh(box(0.45, 0.42, 0.95), matte('#2e2018'), X(0.24), 0.22, Z(tz), g);
    mesh(box(0.06, 0.72, 1.24), matte('#101114'), X(0.04), 1.4, Z(tz), g); // the flat screen's body
  } else {
    mesh(box(0.6, 0.45, 0.85), matte('#6a4a2a'), X(0.33), 0.22, Z(tz), g);
    mesh(box(0.5, 0.42, 0.55), matte('#2a2826'), X(0.3), 0.66, Z(tz), g);
  }
  // The old set only gets snow. The one from the shop (or the penthouse's) gets three channels, all bad.
  const staticFrames = has('tv') || lux
    ? [
        ['#1a0e09', '#e0b25a', GAME_NAME],
        ['#5ab0e8', '#ffd34e', 'SUNNY!'],
        ['#2a2a6a', '#ffffff', 'NEWS'],
      ].map(([bg, fg, text]) =>
        canvasTexture(128, 96, (c) => {
          c.fillStyle = bg;
          c.fillRect(0, 0, 128, 96);
          c.fillStyle = fg;
          c.font = `italic 700 ${text.length > 8 ? 17 : 26}px ${SERIF}`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(text, 64, 48);
          c.fillStyle = 'rgba(255,255,255,0.08)';
          for (let y = 0; y < 96; y += 3) c.fillRect(0, y, 128, 1);
        }),
      )
    : [0, 1, 2].map((k) =>
        canvasTexture(64, 48, (c) => {
          const rnd = seeded(90 + k);
          for (let y = 0; y < 48; y += 2) for (let x = 0; x < 64; x += 2) {
            const v = Math.floor(rnd() * 200);
            c.fillStyle = `rgb(${v},${v},${v + 30})`;
            c.fillRect(x, y, 2, 2);
          }
        }),
      );
  const screenMat = flat('#ffffff', { map: staticFrames[0] });
  const screen = lux ? mesh(plane(1.16, 0.66), screenMat, X(0.075), 1.4, Z(tz), g) : mesh(plane(0.38, 0.3), screenMat, X(0.56), 0.68, Z(tz), g);
  screen.rotation.y = Math.PI / 2;
  const tvGlow = glowSprite('#8fb0ff', lux ? 2.4 : 1.6, 0.35);
  tvGlow.position.set(X(lux ? 0.4 : 0.8), lux ? 1.4 : 0.7, Z(tz));
  g.add(tvGlow);
  if (!lux) {
    // The mess: pizza boxes, a chair with a bucket on it (the ceiling leaks), empties.
    for (let i = 0; i < 4; i++) {
      const p = mesh(box(0.42, 0.05, 0.42), matte(i % 2 ? '#c8b080' : '#d8c090'), X(1.3), 0.025 + i * 0.05, Z(3.1), g);
      p.rotation.y = i * 0.3;
    }
    mesh(box(0.42, 0.04, 0.42), matte('#6a4a2a'), X(w / 2 + 0.4), 0.46, Z(d / 2 + 0.3), g);
    for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) mesh(box(0.04, 0.46, 0.04), matte('#6a4a2a'), X(w / 2 + 0.4 + dx), 0.23, Z(d / 2 + 0.3 + dz), g);
    mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.25, 12), matte('#6a7a8a'), X(w / 2 - 0.3), 0.125, Z(d / 2 - 0.4), g);
    for (const [bx, bz] of L.bath ? [[2.4, 2.3], [2.6, 2.4]] : [[1.9, 0.4], [2.1, 0.5]]) mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 8), matte('#3a5a2a'), X(bx), 0.11, Z(bz), g);
  }

  // A window onto the street, behind dusty blinds, with a pink sign blinking outside.
  // (The penthouse has its wall of glass instead: see the walls.)
  const wx = L.bath ? w - 3.0 : Math.min(w - 2.8, 2.2);
  const neon = glowPlane('#ff4fa0', 1.2, 1.0, 0.7);
  if (!lux) {
    mesh(box(1.3, 1.1, 0.04), matte('#2a2420'), X(wx), 1.6, Z(0.02), g);
    neon.position.set(X(wx), 1.6, Z(0.045));
    g.add(neon);
    for (let i = 0; i < 9; i++) mesh(box(1.25, 0.05, 0.02), matte('#cfc6b0'), X(wx), 1.15 + i * 0.11, Z(0.08), g);
  }

  // A torn poster of the casino across the road.
  const poster = canvasTexture(200, 280, (c) => {
    c.fillStyle = '#1a0e09';
    c.fillRect(0, 0, 200, 280);
    c.fillStyle = '#e0b25a';
    c.font = `italic 700 44px ${SERIF}`;
    c.textAlign = 'center';
    c.fillText('Bet the', 100, 90);
    c.fillText('Debt', 100, 140);
    c.font = '20px sans-serif';
    c.fillText('one more hand', 100, 200);
    c.fillStyle = '#a89a72';
    c.beginPath();
    c.moveTo(150, 280);
    c.lineTo(200, 220);
    c.lineTo(200, 280);
    c.fill();
  });
  if (lux) {
    // Real art: a big abstract over the sofa wall, and a gold-framed one over the bed.
    const art = (seed: number, cw: number, ch: number) =>
      canvasTexture(cw, ch, (c) => {
        const rnd = seeded(seed);
        c.fillStyle = '#f2ece0';
        c.fillRect(0, 0, cw, ch);
        const colours = ['#c8263b', '#1d3f7a', '#e0b25a', '#2a2a2a', '#3f8a6a'];
        for (let i = 0; i < 7; i++) {
          c.fillStyle = colours[Math.floor(rnd() * colours.length)];
          c.globalAlpha = 0.85;
          if (rnd() < 0.5) c.fillRect(rnd() * cw, rnd() * ch, 20 + rnd() * cw * 0.5, 10 + rnd() * ch * 0.4);
          else {
            c.beginPath();
            c.arc(rnd() * cw, rnd() * ch, 15 + rnd() * cw * 0.25, 0, Math.PI * 2);
            c.fill();
          }
        }
        c.globalAlpha = 1;
      });
    const gold = matte('#c9a24a', { emissive: '#3a2a08' });
    const big = mesh(plane(1.5, 1.0), matte('#ffffff', { map: art(900 + slot, 300, 200) }), X(0.03), 1.65, Z(5.0), g);
    big.rotation.y = Math.PI / 2;
    mesh(box(0.03, 1.08, 1.58), gold, X(0.015), 1.65, Z(5.0), g);
    const small = mesh(plane(0.9, 0.6), matte('#ffffff', { map: art(950 + slot, 180, 120) }), X(w - 0.15), 1.75, Z(0.97), g);
    small.rotation.y = -Math.PI / 2;
    mesh(box(0.03, 0.68, 0.98), gold, X(w - 0.135), 1.75, Z(0.97), g);
  } else {
    const pst = mesh(plane(0.55, 0.77), matte('#ffffff', { map: poster }), X(0.02), 1.6, Z(3.2), g);
    pst.rotation.y = Math.PI / 2;
    pst.rotation.z = 0.06;
  }

  if (lux) {
    // A ring chandelier in brass over the middle of the room, and warm downlights.
    const brass = matte('#c9a24a', { emissive: '#3a2a08' });
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 6), brass, X(w / 2), h - 0.3, Z(d / 2), g);
    const ring = mesh(new THREE.TorusGeometry(0.45, 0.025, 8, 40), brass, X(w / 2), h - 0.62, Z(d / 2), g);
    ring.rotation.x = Math.PI / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      mesh(new THREE.SphereGeometry(0.05, 10, 8), flat('#fff2d8'), X(w / 2 + Math.cos(a) * 0.45), h - 0.58, Z(d / 2 + Math.sin(a) * 0.45), g);
    }
    const halo = glowSprite('#ffd8a0', 2.4, 0.7);
    halo.position.set(X(w / 2), h - 0.6, Z(d / 2));
    g.add(halo);
    const main = new THREE.PointLight('#ffe2b8', 12, 0, 2);
    main.position.set(X(w / 2), h - 0.7, Z(d / 2));
    g.add(main);
    for (const [lx, lz] of [[1.2, 4.6], [w - 1.2, 3.6], [w / 2, 1.2]]) {
      mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 14), flat('#fff6e0'), X(lx), h - 0.005, Z(lz), g);
      const down = new THREE.PointLight('#ffe8c8', 3, 0, 2);
      down.position.set(X(lx), h - 0.2, Z(lz));
      g.add(down);
    }
  } else {
    // One bare bulb.
    mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.5, 4), flat('#111'), X(w / 2), h - 0.25, Z(d / 2), g);
    mesh(new THREE.SphereGeometry(0.05, 10, 8), flat('#fff2c8'), X(w / 2), h - 0.52, Z(d / 2), g);
    const halo = glowSprite('#ffcf8a', 1.1, 0.8);
    halo.position.set(X(w / 2), h - 0.52, Z(d / 2));
    g.add(halo);
    const bulb = new THREE.PointLight('#ffcf8a', 7, 0, 2);
    bulb.position.set(X(w / 2), h - 0.6, Z(d / 2));
    g.add(bulb);
  }

  // The desk, with the computer: a chunky old monitor glowing blue, a keyboard, a stool.
  const desk = aptDeskLocal(level);
  const dx = (desk.x0 + desk.x1) / 2;
  const dz = (desk.z0 + desk.z1) / 2;
  const deskWood = matte(lux ? '#3a2416' : '#5a4630');
  mesh(box(desk.x1 - desk.x0, 0.05, desk.z1 - desk.z0), deskWood, X(dx), 0.74, Z(dz), g).castShadow = true;
  for (const [lx, lz] of [[desk.x0 + 0.05, desk.z0 + 0.05], [desk.x0 + 0.05, desk.z1 - 0.05], [desk.x1 - 0.05, desk.z0 + 0.05], [desk.x1 - 0.05, desk.z1 - 0.05]]) {
    mesh(box(0.05, 0.72, 0.05), lux ? matte('#15161a') : deskWood, X(lx), 0.36, Z(lz), g);
  }
  const sx = desk.screen.x;
  const sz = desk.screen.z;
  if (lux) {
    // A slim flat monitor on a stand.
    mesh(box(0.03, 0.34, 0.56), matte('#15161a'), X(sx - 0.16), 0.98, Z(sz), g).castShadow = true;
    mesh(box(0.03, 0.16, 0.05), matte('#8a8e94'), X(sx - 0.12), 0.84, Z(sz), g);
    mesh(box(0.16, 0.015, 0.2), matte('#8a8e94'), X(sx - 0.12), 0.77, Z(sz), g);
  } else {
    mesh(box(0.42, 0.36, 0.44), matte('#cfc6ac'), X(sx + 0.04), 0.96, Z(sz), g).castShadow = true; // the CRT's body
    mesh(box(0.2, 0.06, 0.24), matte('#bdb49a'), X(sx + 0.04), 0.79, Z(sz), g);
  }
  const screenTex = canvasTexture(256, 200, (c) => {
    const grad = c.createLinearGradient(0, 0, 0, 200);
    grad.addColorStop(0, '#1d3f7a');
    grad.addColorStop(1, '#0e1f3e');
    c.fillStyle = grad;
    c.fillRect(0, 0, 256, 200);
    c.fillStyle = '#e8d6a0';
    c.font = `italic 700 30px ${SERIF}`;
    c.textAlign = 'center';
    c.fillText(GAME_NAME, 128, 74);
    c.font = '600 18px sans-serif';
    c.fillStyle = '#c8d8ff';
    c.fillText('LuckyOS · press E to log in', 128, 118);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    for (let y = 0; y < 200; y += 4) c.fillRect(0, y, 256, 1); // scanlines
  });
  const pcScreen = mesh(lux ? plane(0.52, 0.3) : plane(0.34, 0.27), flat('#ffffff', { map: screenTex }), X(sx - 0.185), 0.98, Z(sz), g);
  pcScreen.rotation.y = -Math.PI / 2;
  const pcGlow = glowSprite('#7fa8ff', 0.9, 0.35);
  pcGlow.position.set(X(sx - 0.3), 0.98, Z(sz));
  g.add(pcGlow);
  mesh(box(0.12, 0.025, 0.42), matte('#d8d0b8'), X(sx - 0.26), 0.78, Z(sz), g); // keyboard
  mesh(box(0.08, 0.025, 0.05), matte('#d8d0b8'), X(sx - 0.26), 0.78, Z(sz + 0.34), g); // mouse
  mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 10), matte('#a83a2a'), X(sx - 0.1), 0.81, Z(desk.z0 + 0.12), g); // a mug
  if (lux) {
    // A leather office chair.
    const leather = toon('#2a1e18');
    mesh(box(0.5, 0.1, 0.5), leather, X(desk.x0 - 0.38), 0.5, Z(sz), g);
    mesh(box(0.1, 0.6, 0.5), leather, X(desk.x0 - 0.66), 0.85, Z(sz), g);
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8), matte('#8a8e94'), X(desk.x0 - 0.38), 0.25, Z(sz), g);
    mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 5), matte('#15161a'), X(desk.x0 - 0.38), 0.04, Z(sz), g);
  } else {
    mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 14), matte('#3a2a1e'), X(desk.x0 - 0.35), 0.47, Z(sz), g); // stool
    mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.45, 8), matte('#2a2a2a'), X(desk.x0 - 0.35), 0.22, Z(sz), g);
  }

  // ---- what the money buys ----
  const furniture = aptFurnitureLocal(level);
  if (furniture.armchair) {
    // One-bedroom: a saggy armchair under the window, and a rug.
    const [x0, z0, x1, z1] = furniture.armchair;
    const fabric = toon('#6a3a5a');
    mesh(box(x1 - x0, 0.4, z1 - z0), fabric, X((x0 + x1) / 2), 0.2, Z((z0 + z1) / 2), g).castShadow = true;
    mesh(box(x1 - x0, 0.55, 0.16), fabric, X((x0 + x1) / 2), 0.62, Z(z0 + 0.08), g);
    for (const sx of [x0 + 0.08, x1 - 0.08]) mesh(box(0.16, 0.25, z1 - z0), fabric, X(sx), 0.5, Z((z0 + z1) / 2), g);
  }
  if (furniture.sofa) {
    // The penthouse: a long velvet sofa with its back to the window, cushions, a marble
    // coffee table, a floor lamp, a bar cart, a big plant, and a proper rug.
    const [x0, z0, x1, z1] = furniture.sofa;
    const velvet = toon('#1f5a4a');
    mesh(box(x1 - x0, 0.3, z1 - z0), velvet, X((x0 + x1) / 2), 0.25, Z((z0 + z1) / 2), g).castShadow = true;
    mesh(box(x1 - x0, 0.55, 0.22), velvet, X((x0 + x1) / 2), 0.62, Z(z0 + 0.11), g);
    for (const sx of [x0 + 0.1, x1 - 0.1]) mesh(box(0.2, 0.32, z1 - z0), velvet, X(sx), 0.52, Z((z0 + z1) / 2), g);
    for (const [cx, col] of [[x0 + 0.5, '#e0b25a'], [(x0 + x1) / 2, '#f4efe6'], [x1 - 0.5, '#c8263b']] as const) {
      const cushion = mesh(box(0.42, 0.36, 0.14), toon(col), X(cx), 0.6, Z(z0 + 0.3), g);
      cushion.rotation.x = -0.25;
    }
    for (const lx of [x0 + 0.12, x1 - 0.12]) for (const lz of [z0 + 0.1, z1 - 0.1]) mesh(box(0.05, 0.1, 0.05), matte('#c9a24a'), X(lx), 0.05, Z(lz), g);
    const marble = matte('#efe9e0');
    mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 28), marble, X((x0 + x1) / 2), 0.4, Z(z1 + 0.85), g).castShadow = true;
    mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.38, 12), matte('#c9a24a'), X((x0 + x1) / 2), 0.19, Z(z1 + 0.85), g);
    mesh(box(0.28, 0.04, 0.2), toon('#1d3f7a'), X((x0 + x1) / 2 - 0.15), 0.44, Z(z1 + 0.8), g); // a book
    mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.14, 12), matte('#d8e4ec', { transparent: true, opacity: 0.6 }), X((x0 + x1) / 2 + 0.2), 0.5, Z(z1 + 0.95), g);
    // Bar cart against the left wall: brass, glass shelves, bottles.
    const cart = { x: 0.35, z: 4.85 };
    const brassC = matte('#c9a24a', { emissive: '#3a2a08' });
    for (const [lx, lz] of [[-0.22, -0.4], [0.22, -0.4], [-0.22, 0.4], [0.22, 0.4]]) mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.85, 6), brassC, X(cart.x + lx), 0.43, Z(cart.z + lz), g);
    for (const y of [0.3, 0.8]) mesh(box(0.48, 0.02, 0.86), matte('#cfe0e8', { transparent: true, opacity: 0.55 }), X(cart.x), y, Z(cart.z), g);
    ['#3a5a2a', '#8a4a1a', '#d8d0b8', '#5a1a2a', '#2a3a5a'].forEach((col, i) => {
      mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.26, 10), matte(col, { transparent: true, opacity: 0.85 }), X(cart.x - 0.1 + (i % 2) * 0.2), 0.94, Z(cart.z - 0.32 + i * 0.16), g);
    });
    // A tall plant in the corner by the bed.
    mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.45, 16), matte('#f4efe6'), X(w - 0.35), 0.225, Z(3.05), g);
    for (let i = 0; i < 9; i++) {
      const leaf = mesh(new THREE.SphereGeometry(0.2, 10, 8), toon(i % 2 ? '#3f8a4a' : '#2f7040'), X(w - 0.35 + Math.cos(i * 1.7) * 0.15), 0.7 + i * 0.13, Z(3.05 + Math.sin(i * 1.7) * 0.15), g);
      leaf.scale.set(0.9, 0.5, 1.2);
      leaf.rotation.y = i;
    }
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 8), matte('#b08a45'), X(x1 + 0.35), 0.8, Z(z0 + 0.3), g);
    mesh(new THREE.ConeGeometry(0.22, 0.25, 16, 1, true), toon('#f4e2b0'), X(x1 + 0.35), 1.65, Z(z0 + 0.3), g);
    const lampLight = new THREE.PointLight('#ffd8a0', 4, 0, 2);
    lampLight.position.set(X(x1 + 0.35), 1.5, Z(z0 + 0.3));
    g.add(lampLight);
  }
  if (lux) {
    // A big patterned rug under the sofa and coffee table.
    const rugTex = canvasTexture(256, 192, (c) => {
      c.fillStyle = '#7a2a2a';
      c.fillRect(0, 0, 256, 192);
      c.strokeStyle = '#e0b25a';
      c.lineWidth = 6;
      c.strokeRect(12, 12, 232, 168);
      c.strokeStyle = '#1d3f7a';
      c.lineWidth = 3;
      c.strokeRect(24, 24, 208, 144);
      c.fillStyle = '#e0b25a';
      for (let i = 0; i < 5; i++) {
        c.save();
        c.translate(56 + i * 36, 96);
        c.rotate(Math.PI / 4);
        c.fillRect(-10, -10, 20, 20);
        c.restore();
      }
    });
    const rug = mesh(plane(3.2, 2.3), matte('#ffffff', { map: rugTex }), X(3.1), 0.008, Z(1.55), g);
    rug.rotation.x = -Math.PI / 2;
  } else if (level >= 2) {
    const rug = mesh(plane(Math.min(2.6, w - 3), Math.min(1.8, d - 2.6)), matte('#7a2a2a'), X(w / 2 - 0.3), 0.008, Z(d / 2 + 0.1), g);
    rug.rotation.x = -Math.PI / 2;
  }
  if (has('plant')) {
    const pp = L.bath ? { x: 2.3, z: 2.2 } : { x: 0.3, z: 2.65 }; // (by the bathroom door, in bigger flats)
    mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.3, 12), matte('#a85a32'), X(pp.x), 0.15, Z(pp.z), g);
    for (let i = 0; i < 5; i++) {
      const leaf = mesh(new THREE.SphereGeometry(0.14, 10, 8), toon('#3f8a4a'), X(pp.x + Math.cos(i * 1.3) * 0.08), 0.42 + i * 0.07, Z(pp.z + Math.sin(i * 1.3) * 0.08), g);
      leaf.scale.set(0.7, 1.2, 0.7);
    }
  }
  if (has('neon')) {
    // A pink "LUCKY" sign over the bed. It buzzes.
    const neonTex = canvasTexture(256, 96, (c) => {
      c.fillStyle = 'rgba(0,0,0,0)';
      c.clearRect(0, 0, 256, 96);
      c.font = `italic 700 64px ${SERIF}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.shadowColor = '#ff4fa0';
      c.shadowBlur = 20;
      c.fillStyle = '#ffd0ea';
      c.fillText('LUCKY', 128, 50);
    });
    mesh(plane(1.1, 0.42), flat('#ffffff', { map: neonTex, transparent: true }), X(w - 1.15), 1.75, Z(0.03), g);
    const pinkGlow = glowPlane('#ff4fa0', 1.8, 0.9, 0.35);
    pinkGlow.position.set(X(w - 1.15), 1.75, Z(0.04));
    g.add(pinkGlow);
  }
  if (has('roach-motel')) {
    // The cockroach has checked in. It will not be checking out.
    mesh(box(0.22, 0.08, 0.14), matte('#d8c060'), X(1.7), 0.04, Z(3.3), g);
  }

  // A cockroach, doing laps (unless it has been dealt with).
  const roach = mesh(new THREE.SphereGeometry(0.025, 8, 6), matte('#1a0e08'), X(1), 0.012, Z(3), g);
  roach.scale.set(1.6, 0.5, 1);
  roach.visible = !has('roach-motel') && !lux; // not even a roach can afford the penthouse

  return {
    group: g,
    anim(time: number) {
      screenMat.map = has('tv') ? staticFrames[Math.floor(time / 4) % 3] : staticFrames[Math.floor(time * 14) % 3];
      (neon.material as THREE.MeshBasicMaterial).opacity = Math.sin(time * 3) > -0.2 ? 0.7 : 0.15;
      const a = time * 0.9;
      roach.position.set(X(1.4 + Math.cos(a) * 0.5), 0.012, Z(3 + Math.sin(a * 1.3) * 0.4));
      roach.rotation.y = -a;
    },
  };
}

