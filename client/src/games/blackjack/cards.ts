import * as THREE from 'three';
import type { Card } from '@casino/shared';
import { canvasTexture, flat, FONT } from '../../world/materials';

// Cards are drawn in code: no image files needed.
export const CARD = { w: 0.2, h: 0.28, t: 0.006 };
const PX_W = 200;
const PX_H = 280;
const SUIT_CHAR = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;

const faces = new Map<string, THREE.Texture>();
let back: THREE.Texture | null = null;
let blank: THREE.Texture | null = null;

function paper(c: CanvasRenderingContext2D) {
  c.fillStyle = '#fffaf0';
  c.fillRect(0, 0, PX_W, PX_H);
  c.strokeStyle = '#e4d6bd';
  c.lineWidth = 6;
  c.strokeRect(3, 3, PX_W - 6, PX_H - 6);
}

export function faceTexture(card: Card): THREE.Texture {
  const key = card.rank + card.suit;
  let tex = faces.get(key);
  if (!tex) {
    tex = canvasTexture(PX_W, PX_H, (c) => {
      paper(c);
      const suit = SUIT_CHAR[card.suit];
      c.fillStyle = card.suit === 'H' || card.suit === 'D' ? '#e8395a' : '#2b2238';
      c.textBaseline = 'top';
      c.textAlign = 'left';
      c.font = `700 92px ${FONT}`;
      c.fillText(card.rank, 14, 8);
      c.font = `64px "Segoe UI Symbol", "Arial Unicode MS", sans-serif`;
      c.fillText(suit, 16, 96);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `150px "Segoe UI Symbol", "Arial Unicode MS", sans-serif`;
      c.fillText(suit, PX_W / 2 + 26, PX_H / 2 + 46);
    });
    faces.set(key, tex);
  }
  return tex;
}

export function blankTexture(): THREE.Texture {
  blank ??= canvasTexture(PX_W, PX_H, paper);
  return blank;
}

export function backTexture(): THREE.Texture {
  back ??= canvasTexture(PX_W, PX_H, (c) => {
    c.fillStyle = '#fffaf0';
    c.fillRect(0, 0, PX_W, PX_H);
    c.fillStyle = '#ef4565';
    c.beginPath();
    c.roundRect(12, 12, PX_W - 24, PX_H - 24, 14);
    c.fill();
    c.fillStyle = '#ff8fab';
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        c.beginPath();
        c.arc(36 + x * 32 + (y % 2) * 16 - 8, 38 + y * 34, 7, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.fillStyle = '#ffe08a';
    c.beginPath();
    c.arc(PX_W / 2, PX_H / 2, 34, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ef4565';
    c.beginPath();
    c.arc(PX_W / 2, PX_H / 2, 20, 0, Math.PI * 2);
    c.fill();
  });
  return back;
}

const geometry = new THREE.BoxGeometry(CARD.w, CARD.t, CARD.h);
// A touch warmer and dimmer than pure white, so cards belong in the lamplight.
const TINT = '#f1e4cc';
const edge = flat('#d9cab0');
let backMat: THREE.MeshBasicMaterial | null = null;

/**
 * A card lying flat, face up, with its top edge pointing toward -z.
 * Turn it face down by rotating half a turn around z.
 */
export function makeCardMesh(card: Card | null): { mesh: THREE.Mesh; face: THREE.MeshBasicMaterial } {
  backMat ??= flat(TINT, { map: backTexture() });
  const face = flat(TINT, { map: card ? faceTexture(card) : blankTexture() });
  // Box sides in order: +x, -x, +y (top = face), -y (bottom = back), +z, -z
  const mesh = new THREE.Mesh(geometry, [edge, edge, face, backMat, edge, edge]);
  return { mesh, face };
}
