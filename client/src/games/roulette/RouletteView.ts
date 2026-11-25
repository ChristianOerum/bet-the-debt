import * as THREE from 'three';
import { betLabel, colorOf, OUTSIDE_BETS, RT, WHEEL_ORDER, type RouletteState, type Station } from '@casino/shared';
import { flat, matte, SERIF } from '../../world/materials';
import type { GameViewContext } from '../GameView';
import { BRASS, chipLabel, ChipPiles, feltPrint, offeredChips } from '../props';
import { TableView, type HudParts } from '../TableView';

const WHEEL = new THREE.Vector3(-1.15, 0, 0);
const STEP = (Math.PI * 2) / 37;
const POCKET_R = 0.36;
const TRACK_R = 0.47;
const COLORS = { red: '#b3261e', black: '#1a1416', green: '#1f7a45' } as const;
/** Ball angle (relative to the wheel) at the middle of pocket `n`. */
const pocketAngle = (n: number) => (WHEEL_ORDER.indexOf(n) + 0.5) * STEP;

export class RouletteView extends TableView<RouletteState> {
  private wheel = new THREE.Group();
  private ball: THREE.Mesh;
  private wheelAngle = 0;
  private spin: { id: number; t: number; T: number; result: number } | null = null;
  private rel = 0;
  private ballR = POCKET_R;
  private piles: ChipPiles;
  private amounts = this.shape.seats.map(() => this.label(0.1));
  private resultLabel = this.label(0.22);
  private chip = 10;
  private lastSpin = 0;

  constructor(station: Station, ctx: GameViewContext) {
    super(station, ctx);
    this.focus.set(0, 0, 0);
    this.lookFrac = 0.65;
    const top = this.shape.top;
    const g = this.group;
    const wood = matte('#3f1f13');
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };

    // The table: wooden body, green felt, a padded rail, four sturdy legs.
    add(new THREE.BoxGeometry(3.9, 0.12, 1.7), wood, 0, top - 0.08, 0);
    add(new THREE.BoxGeometry(3.7, 0.02, 1.5), matte('#0f5f63', { emissive: '#041f20' }), 0, top - 0.01, 0);
    for (const z of [-0.82, 0.82]) add(new THREE.BoxGeometry(3.95, 0.09, 0.12), matte('#33140e'), 0, top + 0.01, z);
    for (const x of [-1.97, 1.97]) add(new THREE.BoxGeometry(0.12, 0.09, 1.76), matte('#33140e'), x, top + 0.01, 0);
    for (const [x, z] of [[-1.7, -0.6], [1.7, -0.6], [-1.7, 0.6], [1.7, 0.6]]) add(new THREE.CylinderGeometry(0.07, 0.05, top - 0.14, 10), wood, x, (top - 0.14) / 2, z);

    // The betting layout printed on the felt.
    const layout = feltPrint(2.3, 1.2, (c, W, H) => {
      const cols = 12;
      const x0 = W * 0.08;
      const cw = (W * 0.92 - x0) / cols;
      const rh = (H * 0.66) / 3;
      c.lineWidth = 3;
      c.strokeStyle = '#e6d59a';
      c.font = `700 ${rh * 0.46}px ${SERIF}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = COLORS.green;
      c.fillRect(4, 4, x0 - 8, rh * 3 - 4);
      c.strokeRect(4, 4, x0 - 8, rh * 3 - 4);
      c.fillStyle = '#f1e3c8';
      c.fillText('0', x0 / 2, rh * 1.5);
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < 3; row++) {
          const n = col * 3 + (3 - row);
          const x = x0 + col * cw;
          const y = row * rh + 4;
          c.fillStyle = COLORS[colorOf(n)];
          c.fillRect(x + 4, y + 4, cw - 8, rh - 8);
          c.strokeRect(x, y, cw, rh);
          c.fillStyle = '#f1e3c8';
          c.fillText(String(n), x + cw / 2, y + rh / 2);
        }
      }
      c.font = `700 ${rh * 0.36}px ${SERIF}`;
      const outY = rh * 3 + 10;
      const labels = ['1st 12', '2nd 12', '3rd 12'];
      labels.forEach((l, i) => {
        c.strokeRect(x0 + i * 4 * cw, outY, 4 * cw, rh * 0.8);
        c.fillStyle = '#f1e3c8';
        c.fillText(l, x0 + (i * 4 + 2) * cw, outY + rh * 0.4);
      });
      const evens = ['1–18', 'EVEN', 'RED', 'BLACK', 'ODD', '19–36'];
      evens.forEach((l, i) => {
        const x = x0 + i * 2 * cw;
        const y = outY + rh * 0.8;
        if (l === 'RED' || l === 'BLACK') {
          c.fillStyle = l === 'RED' ? COLORS.red : COLORS.black;
          c.fillRect(x + 6, y + 6, 2 * cw - 12, rh * 0.8 - 12);
        }
        c.strokeRect(x, y, 2 * cw, rh * 0.8);
        c.fillStyle = '#f1e3c8';
        c.fillText(l, x + cw, y + rh * 0.4);
      });
    }, 0.92);
    layout.position.set(0.72, top + 0.002, -0.05);
    g.add(layout);

    // The wheel: a wooden bowl, a turning ring of pockets, a brass turret, and the ball.
    const bowlY = top + 0.02;
    add(new THREE.CylinderGeometry(0.6, 0.56, 0.12, 40), wood, WHEEL.x, bowlY, WHEEL.z);
    add(new THREE.TorusGeometry(0.58, 0.03, 8, 40), BRASS(), WHEEL.x, bowlY + 0.06, WHEEL.z).rotation.x = Math.PI / 2;
    const track = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 40), matte('#5a3a22'));
    track.rotation.x = -Math.PI / 2;
    track.position.set(WHEEL.x, bowlY + 0.061, WHEEL.z);
    g.add(track);
    this.wheel.position.set(WHEEL.x, bowlY + 0.065, WHEEL.z);
    WHEEL_ORDER.forEach((n, i) => {
      const seg = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 2, 1, i * STEP, STEP), flat(COLORS[colorOf(n)], { side: THREE.DoubleSide }));
      seg.rotation.x = -Math.PI / 2;
      this.wheel.add(seg);
      // thin brass frets between pockets
      const a = i * STEP;
      const fret = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.006), BRASS());
      fret.position.set(Math.cos(a) * 0.36, 0.01, -Math.sin(a) * 0.36);
      fret.rotation.y = a;
      this.wheel.add(fret);
    });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 32), matte('#4a2a16'));
    hub.position.y = -0.005;
    this.wheel.add(hub);
    const turret = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 16), BRASS());
    turret.position.y = 0.08;
    this.wheel.add(turret);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), BRASS());
    knob.position.y = 0.16;
    this.wheel.add(knob);
    g.add(this.wheel);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 10), flat('#fbf6ea'));
    this.ball.visible = false;
    g.add(this.ball);

    this.piles = new ChipPiles(g);
  }

  protected sync() {
    const s = this.state!;
    if (s.phase === 'spinning' && s.result !== null && s.spin !== this.lastSpin) {
      // Pick up the spin where it is (we may have joined half way through).
      const T = RT.spinMs / 1000;
      const left = s.timeLeftMs == null ? T : s.timeLeftMs / 1000;
      // Timed by the clock, not by counting frames, so a slow computer still lands on time.
      this.spin = { id: s.spin, t: performance.now() / 1000 - Math.max(0, T - left), T, result: s.result };
      this.lastSpin = s.spin;
      this.ball.visible = true;
    }
    const top = this.shape.top;
    const keep = new Set<string>();
    s.seats.forEach((seat, i) => {
      const lbl = this.amounts[i];
      const sp = this.shape.seats[i];
      const spot = i === 4 ? new THREE.Vector3(1.6, top, 0.35) : new THREE.Vector3(sp.x, top, 0.55);
      if (!seat || seat.total === 0) {
        lbl.set('');
        return;
      }
      keep.add(String(i));
      this.piles.set(String(i), seat.total, spot.x, spot.y, spot.z);
      lbl.set(seat.net !== null && s.phase === 'payout' ? (seat.net >= 0 ? `+${seat.net}` : String(seat.net)) : String(seat.total), '#2a1a08', seat.net !== null && s.phase === 'payout' ? (seat.net > 0 ? '#7be3a4' : '#d6455f') : '#e0b25a');
      lbl.sprite.position.set(spot.x, top + 0.32, spot.z);
    });
    this.piles.prune(keep);

    if (s.phase === 'payout' && s.result !== null) {
      const c = colorOf(s.result);
      this.resultLabel.set(`${s.result} ${c.toUpperCase()}`, '#fff7e6', COLORS[c]);
      this.resultLabel.sprite.position.set(WHEEL.x, top + 0.6, WHEEL.z);
    } else {
      this.resultLabel.set('');
    }
  }

  protected animate(dt: number) {
    const sp = this.spin;
    // sp.t holds the moment the spin started; how far in we are comes from the clock.
    const elapsed = sp ? Math.min(sp.T, performance.now() / 1000 - sp.t) : 0;
    const slowing = sp ? Math.max(0, 1 - elapsed / sp.T) : 0;
    this.wheelAngle += dt * (0.35 + 2.6 * slowing);
    this.wheel.rotation.y = this.wheelAngle;
    if (sp) {
      const x = elapsed / sp.T;
      const ease = 1 - Math.pow(1 - x, 3);
      // The ball runs the other way round, slows, drops off the track and settles in its pocket.
      this.rel = pocketAngle(sp.result) - (1 - ease) * 7 * Math.PI * 2;
      this.ballR = x < 0.72 ? TRACK_R : TRACK_R + (POCKET_R - TRACK_R) * Math.min(1, (x - 0.72) / 0.2);
      if (elapsed >= sp.T) this.spin = null;
    }
    const a = this.wheelAngle + this.rel;
    const hop = this.spin && this.ballR < TRACK_R - 0.01 && this.ballR > POCKET_R + 0.005 ? Math.abs(Math.sin(this.ballR * 120)) * 0.02 : 0;
    this.ball.position.set(WHEEL.x + Math.cos(a) * this.ballR, this.shape.top + 0.11 + hop, WHEEL.z - Math.sin(a) * this.ballR);
  }

  protected hudParts(mine: number): HudParts {
    const s = this.state!;
    const seat = s.seats[mine]!;
    const chips = this.ctx.getChips();
    const open = s.phase === 'waiting' || s.phase === 'betting';
    const history = s.history
      .slice(0, 10)
      .map((n) => `<span class="pip pip-${colorOf(n)}">${n}</span>`)
      .join('');
    const myBets = Object.entries(seat.bets)
      .map(([k, v]) => `${betLabel(k)} <b>${v}</b>`)
      .join(' · ');
    let status = '';
    if (s.phase === 'spinning') status = 'No more bets…';
    else if (s.phase === 'payout') status = seat.net === null ? `${s.result} ${colorOf(s.result!)}` : seat.net > 0 ? `${s.result}! You won <b class="good">+${seat.net}</b>` : seat.net < 0 ? `${s.result}. You lost <b class="bad">${-seat.net}</b>` : `${s.result}. You broke even.`;
    else status = seat.ready ? 'Waiting for the others…' : seat.total ? `Your bets: <b>${seat.total}</b>` : 'Place your bets';
    const canAdd = (open && !seat.ready && seat.total + this.chip <= Math.min(chips, RT.maxBet));

    let body = `<div class="history">${history || '<span class="muted">No spins yet</span>'}</div>`;
    if (myBets) body += `<div class="muted small">${myBets}</div>`;
    if (open) {
      const grid: string[] = [`<button class="num num-green" data-act="bet" data-bet="n0" ${canAdd ? '' : 'disabled'}>0</button>`];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 12; col++) {
          const n = col * 3 + (3 - row);
          grid.push(`<button class="num num-${colorOf(n)}" data-act="bet" data-bet="n${n}" ${canAdd ? '' : 'disabled'}>${n}</button>`);
        }
      }
      body += `<div class="rl-grid">${grid.join('')}</div>`;
      body += `<div class="rl-out">${OUTSIDE_BETS.map((b) => this.btn('bet', b.label, canAdd, `out out-${b.key}`, `data-bet="${b.key}"`)).join('')}</div>`;
    }
    const buttons = open
      ? RT.chipValues.filter((v) => offeredChips(RT.chipValues, chips).includes(v)).map((v) => this.btn('chip', chipLabel(v), true, `chip chip-${v} ${v === this.chip ? 'picked' : ''}`, `data-v="${v}"`)).join('') +
        this.btn('clear', 'Clear', seat.total > 0 && !seat.ready) +
        this.btn('ready', 'Spin', seat.total > 0 && !seat.ready, 'primary')
      : '';
    return { status, body, buttons, timer: s.phase === 'betting', wide: true };
  }

  protected act(act: string, el: HTMLElement) {
    if (act === 'chip') {
      this.chip = Number(el.dataset.v);
      this.renderHud();
    } else if (act === 'bet') this.send({ type: 'bet', bet: el.dataset.bet, amount: this.chip });
    else this.send({ type: act });
  }
}
