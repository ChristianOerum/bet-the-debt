import * as THREE from 'three';
import {
  allowedActions,
  BJ,
  BJ_LAYOUT as L,
  bjSeatLocal,
  bjSeatWorld,
  handValue,
  type BJAction,
  type BJHandState,
  type BJState,
  type Card,
  type Station,
} from '@casino/shared';
import type { Pose } from '../../world/avatars';
import { buildCharacter, disposeObject, partsOf, updateArms } from '../../world/character';
import { TextSprite } from '../../world/labels';
import { canvasTexture, flat, matte, SERIF, toonBright } from '../../world/materials';
import type { GameView, GameViewContext, SeatSpot } from '../GameView';
import { faceTexture, makeCardMesh } from './cards';
import { chipLabel, CHIP_COLORS, offeredChips } from '../props';

const TOP = L.tableHeight;
const SHOE = new THREE.Vector3(-1.5, TOP + 0.12, 0.32);
const chipGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.018, 20);
const chipMats = new Map<number, THREE.Material>();
const chipMat = (value: number, color: string) => {
  let m = chipMats.get(value);
  if (!m) chipMats.set(value, (m = toonBright(color, 0.12)));
  return m;
};

interface CardObj {
  mesh: THREE.Mesh;
  face: THREE.MeshBasicMaterial;
  card: Card | null;
  cur: THREE.Vector3;
  target: THREE.Vector3;
  /** 0 = face up, PI = face down */
  flip: number;
  delay: number;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Draws one blackjack table from the server's state, and shows your buttons when you sit at it. */
export class BlackjackView implements GameView {
  readonly group = new THREE.Group();
  private state: BJState | null = null;
  private cards = new Map<string, CardObj>();
  private cushions: THREE.MeshLambertMaterial[] = [];
  private chipGroups: (THREE.Group | null)[] = [];
  private chipKeys: string[] = [];
  private betLabels: TextSprite[] = [];
  private handLabels: TextSprite[][] = [];
  private dealerLabel = new TextSprite(0.15);
  private pointer: THREE.Mesh;
  private deadline: number | null = null;
  private timerTotal = 1;
  private lastBet = 0;
  private hud = document.createElement('div');
  private hudHtml = '';
  private timerBar: HTMLElement | null = null;

  constructor(
    readonly station: Station,
    private ctx: GameViewContext,
  ) {
    this.group.position.set(station.x, 0, station.z);
    this.group.rotation.y = station.rot;
    this.buildTable();

    for (let i = 0; i < BJ.seats; i++) {
      this.chipGroups.push(null);
      this.chipKeys.push('');
      const bet = new TextSprite(0.1);
      this.betLabels.push(bet);
      const hands = [new TextSprite(0.13), new TextSprite(0.13)];
      this.handLabels.push(hands);
      this.group.add(bet.sprite, hands[0].sprite, hands[1].sprite);
    }
    this.group.add(this.dealerLabel.sprite);

    // A pulsing ring on the felt around the bet of whoever's turn it is.
    this.pointer = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.19, 32), flat('#ffe9b0', { transparent: true }));
    this.pointer.rotation.x = -Math.PI / 2;
    this.pointer.visible = false;
    this.group.add(this.pointer);

    this.hud.className = 'bj-panel';
    this.hud.hidden = true;
    this.hud.addEventListener('click', this.onClick);
    ctx.hudRoot.appendChild(this.hud);
    window.addEventListener('keydown', this.onKey);
  }

  // ---- building the table --------------------------------------------------

  private buildTable() {
    const g = this.group;
    const R = L.tableRadius;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    const wood = matte('#3f1f13');
    const dark = matte('#1f100a');
    const brass = matte('#b08a45', { emissive: '#3a2a10' });

    // Half-circle of teal felt, a padded leather rim, and a wooden rail along the dealer's edge.
    const top = add(new THREE.CylinderGeometry(R, R, 0.1, 56, 1, false, -Math.PI / 2, Math.PI), matte('#0f5f63', { emissive: '#041f20' }), 0, TOP - 0.05, 0);
    top.receiveShadow = true;
    add(new THREE.CylinderGeometry(R - 0.06, R - 0.12, 0.24, 56, 1, false, -Math.PI / 2, Math.PI), wood, 0, TOP - 0.22, 0);
    const rim = add(new THREE.TorusGeometry(R, 0.085, 10, 56, Math.PI), matte('#33140e'), 0, TOP, 0);
    rim.rotation.x = Math.PI / 2;
    const inlay = add(new THREE.TorusGeometry(R - 0.1, 0.012, 6, 56, Math.PI), brass, 0, TOP + 0.004, 0);
    inlay.rotation.x = Math.PI / 2;
    inlay.castShadow = false;
    add(new THREE.BoxGeometry(R * 2 + 0.2, 0.42, 0.2), wood, 0, TOP - 0.15, -0.08);
    add(new THREE.CylinderGeometry(0.3, 0.42, TOP - 0.3, 20), wood, 0, (TOP - 0.3) / 2, 0.85);
    add(new THREE.CylinderGeometry(0.85, 0.9, 0.08, 28), dark, 0, 0.04, 0.85);

    // Printed felt
    const print = canvasTexture(1024, 200, (c) => {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#e6d59a';
      c.font = `700 80px ${SERIF}`;
      c.fillText('BLACKJACK PAYS 3 TO 2', 512, 66);
      c.font = `italic 700 46px ${SERIF}`;
      c.fillText('dealer stands on 17', 512, 152);
    });
    const text = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.33), flat('#ffffff', { map: print, transparent: true, opacity: 0.6 }));
    text.rotation.x = -Math.PI / 2;
    text.position.set(0, TOP + 0.003, 0.86);
    g.add(text);

    const ringGeo = new THREE.RingGeometry(0.1, 0.122, 28);
    const ringMat = flat('#d6b566', { transparent: true, opacity: 0.85 });
    for (let i = 0; i < BJ.seats; i++) {
      const p = this.betSpot(i, 0, 1);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, TOP + 0.003, p.z);
      g.add(ring);
    }

    // Card shoe and the dealer's chip tray
    const shoe = add(new THREE.BoxGeometry(0.3, 0.2, 0.44), dark, SHOE.x, TOP + 0.1, SHOE.z);
    shoe.rotation.y = 0.5;
    add(new THREE.BoxGeometry(1.34, 0.05, 0.2), dark, 0, TOP + 0.025, 0.17);
    CHIP_COLORS.forEach(([value, color], i) => {
      add(new THREE.CylinderGeometry(0.058, 0.058, 0.07, 20), chipMat(value, color), -0.59 + (i * 1.18) / (CHIP_COLORS.length - 1), TOP + 0.085, 0.17);
    });

    // The dealer, hands resting on the rail.
    const dealer = buildCharacter('', 'dealer');
    dealer.position.set(0, 0, L.dealerZ);
    const dp = partsOf(dealer);
    dp.hands[0].position.set(-0.3, 1.0, 0.36);
    dp.hands[1].position.set(0.3, 1.0, 0.36);
    updateArms(dp);
    g.add(dealer);

    // Leather chairs
    const backMat = matte('#4a1a11');
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < BJ.seats; i++) {
      const s = bjSeatLocal(i);
      const { rx, rz } = this.axes(i);
      add(new THREE.CylinderGeometry(0.26, 0.29, 0.04, 20), dark, s.x, 0.02, s.z);
      add(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 10), brass, s.x, 0.27, s.z);
      const cushion = matte('#6a2619');
      this.cushions.push(cushion);
      add(new THREE.CylinderGeometry(0.3, 0.27, 0.14, 22), cushion, s.x, 0.57, s.z);
      // a padded back with a rounded top, on the far side from the table
      const bx = s.x + rx * 0.31;
      const bz = s.z + rz * 0.31;
      const back = add(new THREE.BoxGeometry(0.6, 0.5, 0.1), backMat, bx, 0.95, bz);
      back.rotation.y = s.angle;
      const arch = add(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 20), backMat, bx, 1.2, bz);
      arch.quaternion.setFromUnitVectors(up, new THREE.Vector3(rx, 0, rz));
      for (const side of [-1, 1]) {
        const { tx, tz } = this.axes(i);
        add(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 8), brass, bx + tx * side * 0.24, 0.72, bz + tz * side * 0.24);
      }
    }
  }

  // ---- where things go on the felt (table's own coordinates) ----------------

  /** Unit vectors for a seat: `r` points from the table centre out to the player, `t` to the player's right. */
  private axes(seat: number) {
    const a = bjSeatLocal(seat).angle;
    return { a, rx: Math.sin(a), rz: Math.cos(a), tx: Math.cos(a), tz: -Math.sin(a) };
  }

  private cardPos(seat: number, hand: number, handCount: number, idx: number) {
    const { rx, rz, tx, tz } = this.axes(seat);
    const split = handCount > 1;
    // Each new card lands a little right of and nearer than the last, so every rank stays visible.
    const t = (split ? (hand === 0 ? -0.2 : 0.12) : -0.1) + idx * (split ? 0.05 : 0.085);
    const r = L.cardRadius + idx * (split ? 0.07 : 0.03);
    return new THREE.Vector3(rx * r + tx * t, TOP + 0.005 + idx * 0.002, rz * r + tz * t);
  }

  private betSpot(seat: number, hand: number, handCount: number) {
    const { rx, rz, tx, tz } = this.axes(seat);
    const t = handCount > 1 ? (hand === 0 ? -0.16 : 0.16) : 0;
    return new THREE.Vector3(rx * L.betRadius + tx * t, TOP, rz * L.betRadius + tz * t);
  }

  // ---- GameView ------------------------------------------------------------

  setState(raw: unknown) {
    const s = raw as BJState;
    this.state = s;
    this.deadline = s.timeLeftMs === null ? null : performance.now() + s.timeLeftMs;
    this.timerTotal = s.phase === 'betting' ? BJ.betTimeMs : BJ.turnTimeMs;
    const mine = this.mySeat();
    if (mine >= 0 && s.phase === 'dealing' && s.seats[mine]!.hands[0]) this.lastBet = s.seats[mine]!.hands[0].bet;
    this.syncCards(s);
    this.syncChips(s);
    this.syncLabels(s);
    this.renderHud();
  }

  refresh() {
    this.renderHud();
  }

  seats(): SeatSpot[] {
    return Array.from({ length: BJ.seats }, (_, index) => ({
      index,
      ...bjSeatWorld(this.station, index),
      occupied: !!this.state?.seats[index],
    }));
  }

  seatedPlayers(): Map<number, Pose> {
    const out = new Map<number, Pose>();
    this.state?.seats.forEach((s, i) => {
      if (s && !s.gone) out.set(s.playerId, bjSeatWorld(this.station, i));
    });
    return out;
  }

  mySeat(): number {
    return this.state?.seats.findIndex((s) => s?.playerId === this.ctx.myId && !s.gone) ?? -1;
  }

  cameraPose(seat: number) {
    const s = bjSeatLocal(seat);
    // Look down at a point a little way in from your own cards, so your bet, your cards
    // and the dealer all sit above the button panel.
    const k = 0.6 / L.seatRadius;
    this.group.updateMatrixWorld();
    return {
      pos: this.group.localToWorld(new THREE.Vector3(s.x, 1.74, s.z)),
      look: this.group.localToWorld(new THREE.Vector3(s.x * k, 0.6, s.z * k)),
    };
  }

  highlightSeat(seat: number | null) {
    this.cushions.forEach((m, i) => m.emissive.set(i === seat ? '#8a5a12' : '#000000'));
  }

  update(dt: number, time: number) {
    const move = 1 - Math.exp(-dt * 11);
    const turn = 1 - Math.exp(-dt * 9);
    for (const c of this.cards.values()) {
      if (c.delay > 0) {
        c.delay -= dt;
        continue;
      }
      c.mesh.visible = true;
      c.cur.lerp(c.target, move);
      c.mesh.rotation.z += (c.flip - c.mesh.rotation.z) * turn;
      c.mesh.position.copy(c.cur);
      // Lift the card while it flips so it does not cut through the table.
      c.mesh.position.y += Math.sin(c.mesh.rotation.z) * 0.11;
    }

    const s = this.state;
    if (s?.turn && s.phase === 'players') {
      const count = s.seats[s.turn.seat]?.hands.length ?? 1;
      const p = this.betSpot(s.turn.seat, s.turn.hand, count);
      this.pointer.position.set(p.x, TOP + 0.004, p.z);
      this.pointer.scale.setScalar(1 + Math.sin(time * 6) * 0.08);
      (this.pointer.material as THREE.MeshBasicMaterial).opacity = 0.75 + Math.sin(time * 6) * 0.25;
      this.pointer.visible = true;
    } else {
      this.pointer.visible = false;
    }

    if (this.timerBar) {
      const left = this.deadline === null ? 0 : Math.max(0, this.deadline - performance.now());
      this.timerBar.style.width = `${Math.min(100, (left / this.timerTotal) * 100)}%`;
      this.timerBar.classList.toggle('low', left < 5000);
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    this.hud.remove();
    for (const c of this.cards.values()) c.face.dispose();
    this.cards.clear();
    [...this.betLabels, ...this.handLabels.flat(), this.dealerLabel].forEach((l) => l.dispose());
    this.group.removeFromParent();
    disposeObject(this.group);
  }

  // ---- 3D: cards, chips, labels ----------------------------------------------

  private syncCards(s: BJState) {
    const want = new Map<string, { card: Card | null; pos: THREE.Vector3; rotY: number; order: number }>();
    let player = 0;
    s.seats.forEach((seat, si) => {
      if (!seat || seat.hands.length === 0) return;
      const { a } = this.axes(si);
      seat.hands.forEach((h, hi) =>
        h.cards.forEach((card, ci) =>
          want.set(`${si}:${hi}:${ci}`, {
            card,
            pos: this.cardPos(si, hi, seat.hands.length, ci),
            rotY: a,
            order: ci * 10 + player,
          }),
        ),
      );
      player++;
    });
    const n = s.dealer.length;
    s.dealer.forEach((card, ci) =>
      want.set(`d:${ci}`, {
        card,
        pos: new THREE.Vector3((ci - (n - 1) / 2) * 0.23, TOP + 0.005 + ci * 0.002, 0.55),
        rotY: 0,
        order: ci * 10 + 9,
      }),
    );

    const drop = (key: string, c: CardObj) => {
      this.group.remove(c.mesh);
      c.face.dispose();
      this.cards.delete(key);
    };
    for (const [key, c] of this.cards) if (!want.has(key)) drop(key, c);

    const fresh: { order: number; obj: CardObj }[] = [];
    for (const [key, w] of want) {
      let obj = this.cards.get(key);
      const same = obj && (obj.card === null || (w.card !== null && obj.card.rank === w.card.rank && obj.card.suit === w.card.suit));
      if (obj && !same) {
        drop(key, obj);
        obj = undefined;
      }
      if (!obj) {
        const { mesh, face } = makeCardMesh(w.card);
        mesh.position.copy(SHOE);
        mesh.rotation.z = w.card ? 0 : Math.PI;
        mesh.visible = false;
        this.group.add(mesh);
        obj = { mesh, face, card: w.card, cur: SHOE.clone(), target: w.pos, flip: mesh.rotation.z, delay: 0 };
        this.cards.set(key, obj);
        fresh.push({ order: w.order, obj });
      } else if (obj.card === null && w.card) {
        // The dealer's hidden card is revealed: paint its face and flip it over.
        obj.card = w.card;
        obj.face.map = faceTexture(w.card);
        obj.face.needsUpdate = true;
        obj.flip = 0;
      }
      obj.target = w.pos;
      obj.mesh.rotation.y = w.rotY;
    }
    // New cards leave the shoe one after another, in dealing order.
    fresh.sort((x, y) => x.order - y.order).forEach((f, i) => (f.obj.delay = (i * BJ.dealCardMs) / 1000));
  }

  private syncChips(s: BJState) {
    s.seats.forEach((seat, si) => {
      const amounts = !seat ? [] : seat.hands.length ? seat.hands.map((h) => h.bet) : seat.bet > 0 ? [seat.bet] : [];
      const key = amounts.join(',');
      if (key === this.chipKeys[si]) return;
      this.chipKeys[si] = key;
      const old = this.chipGroups[si];
      if (old) this.group.remove(old);
      this.chipGroups[si] = null;
      const label = this.betLabels[si];
      if (amounts.length === 0) {
        label.set('');
        return;
      }
      const stacks = new THREE.Group();
      amounts.forEach((amount, hi) => {
        const spot = this.betSpot(si, hi, amounts.length);
        let rest = amount;
        let n = 0;
        for (const [value, color] of CHIP_COLORS) {
          while (rest >= value && n < 14) {
            const chip = new THREE.Mesh(chipGeo, chipMat(value, color));
            chip.position.set(spot.x, TOP + 0.01 + n * 0.02, spot.z);
            chip.castShadow = true;
            stacks.add(chip);
            rest -= value;
            n++;
          }
        }
      });
      this.group.add(stacks);
      this.chipGroups[si] = stacks;
      // The amount floats just on the player's side of the chips.
      const { rx, rz } = this.axes(si);
      const out = L.betRadius + 0.2;
      label.set(String(amounts.reduce((a, b) => a + b, 0)), '#2a1a08', '#e0b25a');
      label.sprite.position.set(rx * out, TOP + 0.07, rz * out);
    });
  }

  private syncLabels(s: BJState) {
    const showTotals = s.phase !== 'dealing';
    s.seats.forEach((seat, si) => {
      for (let hi = 0; hi < 2; hi++) {
        const label = this.handLabels[si][hi];
        const hand = seat?.hands[hi];
        if (!hand || !showTotals) {
          label.set('');
          continue;
        }
        const [text, color, bg] = this.handText(hand, s.phase === 'payout');
        label.set(text, color, bg);
        // Sit the bubble low on the felt beside the cards, where it hides nothing:
        // left of the hand, or right of it for the second hand of a split.
        const right = hi === 1;
        const p = this.cardPos(si, hi, seat!.hands.length, right ? hand.cards.length - 1 : 0);
        const { tx, tz } = this.axes(si);
        const side = right ? 0.14 : -0.14;
        label.sprite.center.set(right ? 0 : 1, 0.5); // grow away from the cards
        label.sprite.position.set(p.x + tx * side, TOP + 0.08, p.z + tz * side);
      }
    });

    if (s.dealerTotal !== null && showTotals) {
      const bust = s.dealerTotal > 21;
      this.dealerLabel.set(bust ? 'BUST' : String(s.dealerTotal), '#fff7e6', bust ? '#b3261e' : undefined);
      this.dealerLabel.sprite.center.set(1, 0.5);
      this.dealerLabel.sprite.position.set(-(s.dealer.length * 0.115) - 0.04, TOP + 0.09, 0.55);
    } else {
      this.dealerLabel.set('');
    }
  }

  private handText(h: BJHandState, payout: boolean): [string, string?, string?] {
    const total = handValue(h.cards).total;
    if (payout && h.result) {
      const gain = (h.payout ?? 0) - h.bet;
      // Kept short so a bubble never covers the neighbour's cards.
      if (h.result === 'blackjack') return [`BJ +${gain}`, '#2a1a08', '#ffd34e'];
      if (h.result === 'win') return [`+${gain}`, '#12331f', '#7be3a4'];
      if (h.result === 'push') return ['PUSH', '#2a1a08', '#d9cdb8'];
      return [total > 21 ? 'BUST' : 'LOSE', '#fff7e6', '#b3261e'];
    }
    if (h.status === 'bust') return ['BUST', '#fff7e6', '#b3261e'];
    if (h.status === 'blackjack') return ['BLACKJACK', '#2a1a08', '#ffd34e'];
    return [String(total)];
  }

  // ---- on-screen buttons -----------------------------------------------------

  private renderHud() {
    const s = this.state;
    const mine = this.mySeat();
    if (!s || mine < 0) {
      this.hud.hidden = true;
      this.hudHtml = '';
      this.timerBar = null;
      return;
    }
    const seat = s.seats[mine]!;
    const chips = this.ctx.getChips();
    const btn = (act: string, label: string, enabled: boolean, cls = '', extra = '') =>
      `<button class="${cls}" data-act="${act}" ${extra} ${enabled ? '' : 'disabled'}>${label}</button>`;

    let status = '';
    let buttons = '';
    let timer = false;
    if (s.phase === 'waiting' || s.phase === 'betting') {
      timer = s.phase === 'betting';
      status = seat.ready ? 'Waiting for the others…' : seat.bet > 0 ? `Your bet: <b>${seat.bet}</b>` : 'Place your bet';
      buttons =
        offeredChips(BJ.chipValues, chips)
          .map((v) => btn('bet', `+${chipLabel(v)}`, !seat.ready && seat.bet + v <= Math.min(chips, BJ.maxBet), `chip chip-${v}`, `data-amount="${v}"`))
          .join('') +
        (this.lastBet > 0 && seat.bet === 0 && chips >= this.lastBet
          ? btn('bet', `Same again (${this.lastBet})`, true, '', `data-amount="${this.lastBet}"`)
          : '') +
        btn('clearBet', 'Clear', seat.bet > 0) +
        btn('ready', 'Deal', seat.bet > 0 && !seat.ready, 'primary');
    } else if (s.phase === 'dealing') {
      status = 'Dealing…';
    } else if (s.phase === 'players' && s.turn) {
      const turnSeat = s.seats[s.turn.seat];
      if (s.turn.seat === mine) {
        timer = true;
        const hand = seat.hands[s.turn.hand];
        const ok = allowedActions(hand, seat.hands.length, chips);
        const which = seat.hands.length > 1 ? ` · hand ${s.turn.hand + 1} of 2` : '';
        status = `Your turn: <b>${handValue(hand.cards).total}</b>${which}`;
        buttons =
          btn('hit', 'Hit <kbd>H</kbd>', ok.hit, 'primary') +
          btn('stand', 'Stand <kbd>S</kbd>', ok.stand, 'primary') +
          btn('double', 'Double <kbd>D</kbd>', ok.double) +
          btn('split', 'Split <kbd>P</kbd>', ok.split);
      } else {
        status = seat.hands.length ? `${escapeHtml(turnSeat?.name ?? 'Someone')} is playing…` : 'Round in progress. You are in the next one.';
      }
    } else if (s.phase === 'dealer') {
      status = 'Dealer’s turn…';
    } else if (s.phase === 'payout') {
      if (seat.net === null) status = 'Hand over';
      else if (seat.net > 0) status = `You won <b class="good">+${seat.net}</b>`;
      else if (seat.net < 0) status = `You lost <b class="bad">${-seat.net}</b>`;
      else status = 'Push. Your bet comes back.';
    }

    const html =
      `<div class="bj-status">${status}</div>` +
      `<div class="bj-timer" ${timer ? '' : 'hidden'}><i></i></div>` +
      `<div class="bj-buttons">${buttons}</div>` +
      `<button class="bj-leave" data-act="leave">Leave table</button>`;
    this.hud.hidden = false;
    if (html !== this.hudHtml) {
      this.hudHtml = html;
      this.hud.innerHTML = html;
      this.timerBar = this.hud.querySelector<HTMLElement>('.bj-timer i');
    }
  }

  private onClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act!;
    if (act === 'leave') this.ctx.leave();
    else if (act === 'bet') this.send({ type: 'bet', amount: Number(el.dataset.amount) });
    else this.send({ type: act } as BJAction);
  };

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT' || e.repeat) return;
    const s = this.state;
    const mine = this.mySeat();
    if (!s || mine < 0 || s.phase !== 'players' || s.turn?.seat !== mine) return;
    const type = ({ KeyH: 'hit', KeyS: 'stand', KeyD: 'double', KeyP: 'split' } as const)[e.code as 'KeyH'];
    if (type) this.send({ type });
  };

  private send(action: BJAction) {
    this.ctx.send(action);
  }
}
