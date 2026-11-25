import * as THREE from 'three';
import { RR, type RussianState, type Station } from '@casino/shared';
import { dryClick } from '../../sfx';
import { buildGun } from '../../world/character';
import type { GameViewContext } from '../GameView';
import { roundTable } from '../props';
import { escapeHtml, TableView, type HudParts } from '../TableView';

/** A small scarred table, six chairs, and a revolver that floats to whoever is next. */
export class RussianView extends TableView<RussianState> {
  private gun = buildGun();
  private gunTarget = new THREE.Vector3(0, 0, 0);
  private aimAt = new THREE.Vector3();
  private kick = 0;
  private lastPull = 0;
  private status = this.label(0.14);

  constructor(station: Station, ctx: GameViewContext) {
    super(station, ctx);
    this.lookFrac = 0.6;
    this.lookY = 0.9;
    this.group.add(roundTable(0.85, this.shape.top, '#3a2a1e'));
    this.gun.scale.setScalar(0.8);
    this.gun.position.set(0, this.shape.top + 0.06, 0);
    this.gun.rotation.set(Math.PI / 2, 0, 0);
    this.group.add(this.gun);
  }

  protected sync() {
    const s = this.state!;
    const top = this.shape.top;
    if (s.lastPull && s.lastPull.n !== this.lastPull) {
      this.lastPull = s.lastPull.n;
      this.kick = 1;
      if (!s.lastPull.bang) dryClick();
    }
    if (s.phase === 'playing' && s.turn !== null) {
      // Hovering beside the head of whoever holds it, pointing at their temple.
      const sp = this.shape.seats[s.turn];
      const tx = Math.cos(sp.angle);
      const tz = -Math.sin(sp.angle);
      // When it is at your own head, hold it a little further out so you can see it in the corner of your eye.
      const mineNow = s.turn === this.mySeat();
      const side = mineNow ? 0.5 : 0.38;
      const fwd = mineNow ? 0.35 : 0;
      this.gunTarget.set(sp.x + tx * side - Math.sin(sp.angle) * fwd, mineNow ? 1.55 : 1.66, sp.z + tz * side - Math.cos(sp.angle) * fwd);
      this.aimAt.set(sp.x, 1.62, sp.z);
      this.status.set(`Pull ${s.pulls + 1} of ${RR.chambers}`);
    } else {
      this.gunTarget.set(0, top + 0.06, 0);
      this.aimAt.set(0, top + 0.06, 1);
      this.status.set(s.phase === 'result' && s.result ? `${s.result.victim} found the bullet` : s.phase === 'starting' ? 'Spinning the cylinder…' : '');
    }
    this.status.sprite.position.set(0, top + 0.75, 0);
  }

  protected animate(dt: number) {
    const k = 1 - Math.exp(-dt * 5);
    this.gun.position.lerp(this.gunTarget, k);
    const resting = this.gunTarget.y < 1;
    if (resting) {
      this.gun.rotation.set(Math.PI / 2, 0, 0);
    } else {
      this.gun.lookAt(this.group.localToWorld(this.aimAt.clone()));
    }
    this.kick *= Math.exp(-dt * 10);
    this.gun.rotateX(-this.kick * 0.5);
  }

  protected hudParts(mine: number): HudParts {
    const s = this.state!;
    const seat = s.seats[mine]!;
    const ins = s.seats.filter((x) => x?.ready).map((x) => escapeHtml(x!.name));
    const seated = s.seats.filter((x) => x && !x.gone).length;
    if (s.phase === 'waiting' || s.phase === 'starting') {
      return {
        status: s.phase === 'starting' ? 'Here we go…' : seat.ready ? 'Waiting for everyone at the table…' : 'One bullet. Six chambers.',
        body: `<div class="muted small">Whoever finds the bullet dies, and the others split everything they had. Everyone sitting here must be in. ${seated < 2 ? 'You need someone to play with.' : ''}</div>${ins.length ? `<div class="muted">In: <b>${ins.join(', ')}</b></div>` : ''}`,
        buttons: seat.ready ? this.btn('unready', 'Wait, no') : this.btn('ready', "I'm in", true, 'primary danger'),
        timer: s.phase === 'starting',
      };
    }
    if (s.phase === 'result' && s.result) {
      return {
        status: `<b class="bad">Bang.</b> ${escapeHtml(s.result.victim)} is out.`,
        body: s.result.survivors ? `<div>The survivors split <b class="good">${s.result.stack}</b> chips: <b>${s.result.share}</b> each.</div>` : '',
      };
    }
    if (!seat.inGame) return { status: 'Watching…' };
    if (s.turn === mine) {
      return {
        status: `Your turn. Pull ${s.pulls + 1} of ${RR.chambers}.`,
        body: `<div class="muted small">${RR.chambers - s.pulls} chambers left, one of them loaded.</div>`,
        buttons: this.btn('pull', 'Pull the trigger <kbd>Space</kbd>', true, 'primary danger'),
        timer: true,
      };
    }
    return { status: `${this.name(s.turn)} has the gun…`, timer: true };
  }

  protected act(act: string) {
    this.send({ type: act });
  }

  protected onKey(e: KeyboardEvent) {
    if (e.code === 'Space' && this.state?.phase === 'playing' && this.state.turn === this.mySeat()) {
      e.preventDefault();
      this.send({ type: 'pull' });
    }
  }
}
