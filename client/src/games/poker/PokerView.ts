import * as THREE from 'three';
import { describeHand, PK, type PokerSecret, type PokerState, type Station } from '@casino/shared';
import { flat, matte } from '../../world/materials';
import type { GameViewContext } from '../GameView';
import { CardSet, ChipPiles, type WantedCard } from '../props';
import { escapeHtml, TableView, type HudParts } from '../TableView';

const RX = 1.9;
const RZ = 1.2;

export class PokerView extends TableView<PokerState, PokerSecret> {
  private cards: CardSet;
  private piles: ChipPiles;
  private button: THREE.Mesh;
  private ring: THREE.Mesh;
  private seatLabels = this.shape.seats.map(() => this.label(0.11));
  private betLabels = this.shape.seats.map(() => this.label(0.09));
  private potLabel = this.label(0.13);

  constructor(station: Station, ctx: GameViewContext) {
    super(station, ctx);
    this.lookFrac = 0.62;
    const g = this.group;
    const top = this.shape.top;
    const oval = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(1, 1, RZ / RX);
      m.position.y = y;
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const wood = matte('#3f1f13');
    oval(new THREE.CylinderGeometry(RX, RX, 0.08, 56), matte('#1d5a3a', { emissive: '#05180e' }), top - 0.04);
    const rim = oval(new THREE.TorusGeometry(RX, 0.09, 10, 56), matte('#2a120c'), top);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1, RZ / RX, 1);
    oval(new THREE.CylinderGeometry(RX - 0.06, RX - 0.14, 0.2, 56), wood, top - 0.18);
    for (const x of [-0.9, 0.9]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, top - 0.28, 16), wood);
      leg.position.set(x, (top - 0.28) / 2, 0);
      g.add(leg);
    }
    // A thin inner line on the felt, like a racetrack.
    const line = new THREE.Mesh(new THREE.TorusGeometry(RX * 0.7, 0.008, 4, 64), flat('#c9a24a', { transparent: true, opacity: 0.5 }));
    line.rotation.x = Math.PI / 2;
    line.scale.set(1, RZ / RX, 1);
    line.position.y = top + 0.002;
    g.add(line);

    this.button = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 20), flat('#f6f1e4'));
    this.button.visible = false;
    g.add(this.button);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.24, 32), flat('#ffe9b0', { transparent: true }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    g.add(this.ring);

    this.cards = new CardSet(g, new THREE.Vector3(0, top + 0.3, -1.4));
    this.piles = new ChipPiles(g);
  }

  /** Where things go for a seat: `f` of the way from the seat to the middle. */
  private spot(i: number, f: number, y = this.shape.top) {
    return this.toward(i, f, y);
  }

  protected sync() {
    const s = this.state!;
    const top = this.shape.top;
    const mine = this.mySeat();
    const want = new Map<string, WantedCard>();
    s.board.forEach((c, k) => want.set(`b${s.hand}:${k}`, { card: c, pos: new THREE.Vector3((k - 2) * 0.24, top + 0.005, -0.05), rotY: 0, order: 20 + k }));
    s.seats.forEach((seat, i) => {
      if (!seat || !seat.inHand || seat.folded) return;
      const sp = this.shape.seats[i];
      const at = this.spot(i, 0.48, top + 0.006);
      const tx = Math.cos(sp.angle);
      const tz = -Math.sin(sp.angle);
      const mineCards = i === mine ? this.secret?.cards : null;
      for (let k = 0; k < 2; k++) {
        const card = seat.shown?.[k] ?? mineCards?.[k] ?? null;
        const off = (k - 0.5) * 0.15;
        want.set(`h${s.hand}:${i}:${k}`, { card, pos: new THREE.Vector3(at.x + tx * off, at.y + k * 0.002, at.z + tz * off), rotY: sp.angle, order: k * 10 + i });
      }
    });
    this.cards.sync(want);

    const keep = new Set<string>();
    s.seats.forEach((seat, i) => {
      const name = this.seatLabels[i];
      const bet = this.betLabels[i];
      if (!seat) {
        name.set('');
        bet.set('');
        return;
      }
      const at = this.spot(i, 0.3);
      if (seat.bet > 0) {
        keep.add(`s${i}`);
        this.piles.set(`s${i}`, seat.bet, at.x, top, at.z);
        bet.set(String(seat.bet), '#2a1a08', '#e0b25a');
        bet.sprite.position.set(at.x, top + 0.2, at.z);
      } else bet.set('');
      // What they last did, or what they won.
      const lp = this.spot(i, 0.62, top + 0.3);
      if (s.phase === 'showdown' && seat.won) name.set(`Wins ${seat.won}${seat.handName ? ` · ${seat.handName}` : ''}`, '#12331f', '#7be3a4');
      else if (s.phase === 'showdown' && seat.handName) name.set(seat.handName);
      else if (seat.lastAction) name.set(seat.lastAction, seat.folded ? '#b9a888' : undefined);
      else name.set('');
      name.sprite.position.copy(lp);
    });
    if (s.pot > 0) {
      const street = s.seats.reduce((t, x) => t + (x?.bet ?? 0), 0);
      const middle = s.pot - street;
      keep.add('pot');
      this.piles.set('pot', middle, 0.55, top, 0.35);
      this.potLabel.set(`Pot ${s.pot}`, '#2a1a08', '#e0b25a');
      this.potLabel.sprite.position.set(0, top + 0.32, 0.35);
    } else this.potLabel.set('');
    this.piles.prune(keep);

    if (s.button >= 0 && s.phase !== 'waiting') {
      const b = this.spot(s.button, 0.22, top + 0.01);
      const sp = this.shape.seats[s.button];
      this.button.position.set(b.x + Math.cos(sp.angle) * 0.35, b.y, b.z - Math.sin(sp.angle) * 0.35);
      this.button.visible = true;
    } else this.button.visible = false;
  }

  protected animate(dt: number, time: number) {
    this.cards.update(dt);
    const s = this.state;
    if (s && s.turn !== null) {
      const p = this.spot(s.turn, 0.48, this.shape.top + 0.004);
      this.ring.position.copy(p);
      this.ring.scale.setScalar(1 + Math.sin(time * 6) * 0.08);
      this.ring.visible = true;
    } else this.ring.visible = false;
  }

  protected hudParts(mine: number): HudParts {
    const s = this.state!;
    const seat = s.seats[mine]!;
    const chips = this.ctx.getChips();
    const myCards = this.secret?.cards ?? [];
    const hand = myCards.length === 2 && seat.inHand && !seat.folded ? describeHand([...myCards, ...s.board]) : '';
    const body = hand ? `<div class="muted">You have: <b>${hand}</b></div>` : '';
    if (s.phase === 'waiting') {
      const seated = s.seats.filter((x) => x && !x.gone).length;
      return {
        status: seated < 2 ? 'Waiting for another player…' : 'Next hand starting…',
        body: `<div class="muted small">No-limit Hold'em · blinds ${PK.smallBlind}/${PK.bigBlind} · you need ${PK.bigBlind} chips to be dealt in</div>`,
        timer: s.timeLeftMs != null,
      };
    }
    if (s.phase === 'showdown') {
      return { status: seat.won ? `You win <b class="good">${seat.won}</b>` : seat.inHand ? 'Hand over' : 'Hand over', body };
    }
    if (!seat.inHand) return { status: 'Sitting this hand out. You are in the next one.' };
    if (seat.folded) return { status: 'You folded.', body };
    if (s.turn !== mine) return { status: `${this.name(s.turn)} to act…`, body };

    const toCall = s.currentBet - seat.bet;
    const max = seat.bet + chips;
    const minTo = Math.min(max, s.currentBet + s.minRaise);
    const potTo = Math.min(max, s.currentBet + s.pot + toCall);
    const buttons =
      this.btn('fold', 'Fold <kbd>F</kbd>', true) +
      (toCall > 0 ? this.btn('call', `Call ${Math.min(toCall, chips)} <kbd>C</kbd>`, true, 'primary') : this.btn('check', 'Check <kbd>C</kbd>', true, 'primary')) +
      (max > s.currentBet ? this.btn('raise', `Raise to ${minTo}`, minTo > s.currentBet, '', `data-to="${minTo}"`) : '') +
      (potTo > minTo ? this.btn('raise', `Pot (${potTo})`, true, '', `data-to="${potTo}"`) : '') +
      this.btn('allin', `All in (${max})`, chips > 0);
    return {
      status: toCall > 0 ? `Your turn · <b>${toCall}</b> to call` : 'Your turn',
      body: body + `<div class="muted small">Pot ${s.pot} · ${escapeHtml(String(chips))} behind</div>`,
      buttons,
      timer: true,
    };
  }

  protected act(act: string, el: HTMLElement) {
    if (act === 'raise') this.send({ type: 'raise', to: Number(el.dataset.to) });
    else this.send({ type: act });
  }

  protected onKey(e: KeyboardEvent) {
    const s = this.state;
    if (!s || s.turn !== this.mySeat()) return;
    const seat = s.seats[this.mySeat()]!;
    if (e.code === 'KeyF') this.send({ type: 'fold' });
    if (e.code === 'KeyC') this.send({ type: seat.bet < s.currentBet ? 'call' : 'check' });
  }

  dispose() {
    this.cards.dispose();
    super.dispose();
  }
}
