import * as THREE from 'three';

/** Rounded and friendly: name tags, chat, anything the silly characters "say". */
export const FONT = '"Fredoka", "Trebuchet MS", "Segoe UI", sans-serif';
/** Old-money serif: signs, plaques, anything that belongs to the house. */
export const SERIF = '"Playfair Display", Georgia, "Times New Roman", serif';

// Three flat steps of light instead of a smooth fade: this is what gives the cartoon look.
const steps = new Uint8Array([110, 190, 255]);
const gradientMap = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
gradientMap.minFilter = THREE.NearestFilter;
gradientMap.magFilter = THREE.NearestFilter;
gradientMap.needsUpdate = true;

/** Cartoon shading, for characters and props. */
export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap, ...extra });
}

/**
 * Cartoon shading that also glows a little in its own colour, so the silly
 * characters stay bright and readable in a dark room.
 */
export function toonBright(color: THREE.ColorRepresentation, glow = 0.3) {
  return toon(color, { emissive: color, emissiveIntensity: glow });
}

/** Soft, smooth shading for the building itself: walls, floor, wood. */
export function matte(color: THREE.ColorRepresentation, extra: THREE.MeshLambertMaterialParameters = {}) {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

/** Unlit colour: for things that glow or must stay readable (bulbs, signs, cards). */
export function flat(color: THREE.ColorRepresentation, extra: THREE.MeshBasicMaterialParameters = {}) {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra });
}

export function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let glowTex: THREE.Texture | null = null;

/**
 * A soft blob of light painted onto the air or a wall. Far cheaper than a real
 * lamp, and it is most of what makes the room feel warm and dim.
 */
export function glowMaterial(color: THREE.ColorRepresentation, opacity = 1) {
  glowTex ??= canvasTexture(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
  return {
    map: glowTex,
    color: new THREE.Color(color),
    opacity,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  };
}

export function glowSprite(color: THREE.ColorRepresentation, size: number, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial(glowMaterial(color, opacity)));
  s.scale.set(size, size, 1);
  return s;
}

/** A glow lying flat against a wall (or the floor): the pool of light under a lamp. */
export function glowPlane(color: THREE.ColorRepresentation, w: number, h: number, opacity = 1) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial(glowMaterial(color, opacity)));
}
