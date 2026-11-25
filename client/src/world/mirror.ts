// Real mirrors: the scene drawn again from the mirrored point of view, every frame the mirror
// is in sight (and not at all when it is not, or when you are behind it).
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

/**
 * Run around every mirror's own render. The game uses it to put your own body in the mirror
 * (you have none in first person) and take your floating first-person arms out of it.
 */
export const mirrorHooks = {
  before: () => {},
  after: () => {},
};

/** A mirror `w` by `h` metres, facing +z (turn and place it like a plane). */
export function makeMirror(w: number, h: number, tint = '#d0dade'): THREE.Object3D {
  // About 1000 pixels per metre (up to 1024): sharp when you lean in to look at yourself.
  const mirror = new Reflector(new THREE.PlaneGeometry(w, h), {
    textureWidth: Math.min(1024, Math.round(w * 1000)),
    textureHeight: Math.min(1024, Math.round(h * 1000)),
    color: new THREE.Color(tint),
    clipBias: 0.003,
    multisample: 0,
  });
  const render = mirror.onBeforeRender;
  mirror.onBeforeRender = function (this: Reflector, ...args: Parameters<typeof render>) {
    mirrorHooks.before();
    try {
      render.apply(this, args);
    } finally {
      mirrorHooks.after();
    }
  };
  return mirror;
}
