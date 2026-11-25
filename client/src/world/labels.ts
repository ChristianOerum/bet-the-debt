import * as THREE from 'three';
import { FONT } from './materials';

/** A little text bubble that floats in the 3D world and always faces the camera. */
export class TextSprite {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private key = '';

  /** `height` is the bubble's height in metres. */
  constructor(private height: number) {
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false, fog: false }),
    );
    this.sprite.visible = false;
  }

  set(text: string, color = '#f6ead2', bg = 'rgba(20, 12, 8, 0.9)') {
    const key = `${text}|${color}|${bg}`;
    if (key === this.key) return;
    this.key = key;
    if (!text) {
      this.sprite.visible = false;
      return;
    }
    const ctx = this.canvas.getContext('2d')!;
    const font = `600 46px ${FONT}`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 48;
    const h = 76;
    this.canvas.width = w;
    this.canvas.height = h;
    ctx.font = font;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, 30);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 3);
    // The canvas changed size, so the old GPU copy has to go.
    this.tex.dispose();
    this.tex.needsUpdate = true;
    this.sprite.scale.set((this.height * w) / h, this.height, 1);
    this.sprite.visible = true;
  }

  dispose() {
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}
