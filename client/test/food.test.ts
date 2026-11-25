import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DRUGS, GUNS, MENU } from '@casino/shared';
import { buildFood, MODELLED } from '../src/world/food';

describe('food and drink models', () => {
  it('every item on the menu (and in the fridge) has its own model', () => {
    for (const m of MENU) expect(MODELLED, m.id).toContain(m.id);
  });

  it('each one builds, is hand-sized, and empties as you eat or drink it', () => {
    for (const m of MENU) {
      const f = buildFood(m.id);
      const size = new THREE.Box3().setFromObject(f.group).getSize(new THREE.Vector3());
      expect(size.y, m.id).toBeGreaterThan(0.01);
      expect(Math.max(size.x, size.y, size.z), m.id).toBeLessThan(0.35); // fits in a hand
      for (const left of [1, 0.66, 0.33, 0]) expect(() => f.setLeft(left), m.id).not.toThrow();
      f.update?.(1.5);
    }
  });

  it('guns and drugs have models too; a gun is held out and flashes when fired', () => {
    for (const id of [...GUNS.map((g) => g.id), ...DRUGS.map((d) => d.id)]) {
      expect(MODELLED, id).toContain(id);
      const size = new THREE.Box3().setFromObject(buildFood(id).group).getSize(new THREE.Vector3());
      expect(Math.max(size.x, size.y, size.z), id).toBeLessThan(0.35);
    }
    const gun = buildFood('pistol-silenced');
    expect(gun.aim).toBe(true);
    const flash = () => {
      let on = false;
      gun.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.Material).blending === THREE.AdditiveBlending && o.parent?.visible) on = true;
      });
      return on;
    };
    gun.update!(1);
    expect(flash()).toBe(false);
    gun.fire!();
    expect(flash()).toBe(true);
    gun.update!(1.2);
    expect(flash()).toBe(false);
  });

  it('a glass of lager has less beer in it after a sip', () => {
    const f = buildFood('lager');
    const beerHeight = () => {
      let h = 0;
      f.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && (mesh.material as THREE.MeshLambertMaterial).color?.getHexString() === 'f0b020') h = mesh.scale.y;
      });
      return h;
    };
    f.setLeft(1);
    const full = beerHeight();
    f.setLeft(0.33);
    expect(beerHeight()).toBeLessThan(full * 0.5);
  });
});
