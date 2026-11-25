import * as THREE from 'three';
import { BAC, BAC_SIDES, BJ_LAYOUT as L, type BaccaratState, type BacSide, type Station } from '@casino/shared';
import { matte, SERIF } from '../../world/materials';
import type { GameViewContext } from '../GameView';
import { CardSet, chipLabel, ChipPiles, feltPrint, offeredChips, type WantedCard } from '../props';
import { TableView, type HudParts } from '../TableView';

const NAMES: Record<BacSide, string> = { player: 'Player', banker: 'Banker', tie: 'Tie' };
const COLORS: Record<BacSide, string> = { player: '#4a8fe0', banker: '#d6455f', tie: '#3ecf8e' };
const SHOE = new THREE.Vector3(-1.5, L.tableHeight + 0.12, 0.32);

export class BaccaratView extends TableView<BaccaratState> {
  private cards: CardSet;
  private piles: ChipPiles;
  private seatLabels = this.shape.seats.map(() => this.label(0.1));
  private totals = { player: this.label(0.15), banker: this.label(0.15) };
  private chip = 10;
  private revealAt = 0;

  constructor(station: Station, ctx: GameViewContext) {
    super(station, ctx);
    const g = this.group;
    const R = L.tableRadius;
    const TOP = L.tableHeight;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    const wood = matte('#3f1f13');
    // Same half-moon as blackjack, in a deep burgundy felt.
    add(new THREE.CylinderGeometry(R, R, 0.1, 56, 1, false, -Math.PI / 2, Math.PI), matte('#5c1420', { emissive: '#1a0408' }), 0, TOP - 0.05, 0).receiveShadow = true;
    add(new THREE.CylinderGeometry(R - 0.06, R - 0.12, 0.24, 56, 1, false, -Math.PI / 2, Math.PI), wood, 0, TOP - 0.22, 0);
    add(new THREE.TorusGeometry(R, 0.085, 10, 56, Math.PI), matte('#33140e'), 0, TOP, 0).rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(R * 2 + 0.2, 0.42, 0.2), wood, 0, TOP - 0.15, -0.08);
    add(new THREE.CylinderGeometry(0.3, 0.42, TOP - 0.3, 20), wood, 0, (TOP - 0.3) / 2, 0.85);
    add(new THREE.BoxGeometry(0.3, 0.2, 0.44), matte('#1f100a'), SHOE.x, TOP + 0.1, SHOE.z).rotation.y = 0.5;

    const print = feltPrint(2.6, 0.75, (c, W, H) => {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const boxes: [BacSide, number][] = [
        ['player', W * 0.2],
        ['tie', W * 0.5],
        ['banker', W * 0.8],
      ];
      c.lineWidth = 5;
      for (const [side, x] of boxes) {
        c.strokeStyle = COLORS[side];
        c.strokeRect(x - W * 0.13, H * 0.2, W * 0.26, H * 0.6);
        c.fillStyle = '#ecd9a6';
        c.font = `700 ${H * 0.22}px ${SERIF}`;
        c.fillText(NAMES[side].toUpperCase(), x, H * 0.43);
        c.font = `italic 700 ${H * 0.13}px ${SERIF}`;
        c.fillText(side === 'tie' ? 'pays 8 to 1' : side === 'banker' ? 'pays 19 to 20' : 'pays 1 to 1', x, H * 0.66);
      }
    });
    print.position.set(0, TOP + 0.003, 1.05);
    g.add(print);

    this.cards = new CardSet(g, SHOE, BAC.cardMs / 1000);
    this.piles = new ChipPiles(g);
  }

  protected sync() {
    const s = this.state!;
    const TOP = L.tableHeight;
    const want = new Map<string, WantedCard>();
    const count = { player: 0, banker: 0 };
    s.cards.forEach((c, i) => {
      const k = count[c.side]++;
      // Player hand on the left, banker on the right; a third card is laid sideways.
      const x = (c.side === 'player' ? -0.62 : 0.38) + k * 0.24;
      want.set(`${s.coup}:${i}`, { card: c.card, pos: new THREE.Vector3(x, TOP + 0.005 + i * 0.001, 0.5), rotY: k === 2 ? Math.PI / 2 : 0, order: i });
    });
    this.cards.sync(want);
    if (s.phase === 'dealing') this.revealAt = performance.now() + s.cards.length * BAC.cardMs;

    const keep = new Set<string>();
    s.seats.forEach((seat, i) => {
      const lbl = this.seatLabels[i];
      if (!seat) {
        lbl.set('');
        return;
      }
      const total = seat.bets.player + seat.bets.banker + seat.bets.tie;
      const a = this.shape.seats[i].angle;
      const spot = new THREE.Vector3(Math.sin(a) * L.betRadius, TOP, Math.cos(a) * L.betRadius);
      if (total > 0) {
        keep.add(String(i));
        this.piles.set(String(i), total, spot.x, spot.y, spot.z);
      }
      const parts = BAC_SIDES.filter((k) => seat.bets[k] > 0).map((k) => `${NAMES[k][0]} ${seat.bets[k]}`);
      const net = s.phase === 'payout' ? seat.net : null;
      lbl.set(net !== null ? (net >= 0 ? `+${net}` : String(net)) : parts.join(' · '), '#2a1a08', net !== null ? (net > 0 ? '#7be3a4' : net < 0 ? '#d6455f' : '#d9cdb8') : '#e0b25a');
      lbl.sprite.position.set(spot.x, TOP + 0.3, spot.z);
    });
    this.piles.prune(keep);

    const done = s.phase === 'payout';
    for (const side of ['player', 'banker'] as const) {
      const t = side === 'player' ? s.playerTotal : s.bankerTotal;
      const won = s.winner === side;
      this.totals[side].set(done && t !== null ? `${NAMES[side]} ${t}` : '', won ? '#12331f' : '#f6ead2', won ? '#7be3a4' : undefined);
      this.totals[side].sprite.position.set(side === 'player' ? -0.4 : 0.6, TOP + 0.3, 0.5);
    }
  }

  protected animate(dt: number) {
    this.cards.update(dt);
  }

  protected hudParts(mine: number): HudParts {
    const s = this.state!;
    const seat = s.seats[mine]!;
    const chips = this.ctx.getChips();
    const open = s.phase === 'waiting' || s.phase === 'betting';
    const total = seat.bets.player + seat.bets.banker + seat.bets.tie;
    let status = '';
    if (s.phase === 'dealing') status = 'Dealing…';
    else if (s.phase === 'payout') {
      const w = s.winner ? (s.winner === 'tie' ? 'A tie' : `${NAMES[s.winner]} wins`) : '';
      status = seat.net === null ? w : seat.net > 0 ? `${w}. You won <b class="good">+${seat.net}</b>` : seat.net < 0 ? `${w}. You lost <b class="bad">${-seat.net}</b>` : `${w}. Your bet comes back.`;
    } else status = seat.ready ? 'Waiting for the others…' : total ? `Your bets: <b>${total}</b>` : 'Bet on Player, Banker, or a Tie';
    const road = s.history
      .slice(0, 14)
      .map((h) => `<span class="pip" style="background:${COLORS[h]}">${h[0].toUpperCase()}</span>`)
      .join('');
    const canAdd = open && !seat.ready && total + this.chip <= Math.min(chips, BAC.maxBet);
    const mineBets = BAC_SIDES.filter((k) => seat.bets[k] > 0)
      .map((k) => `${NAMES[k]} <b>${seat.bets[k]}</b>`)
      .join(' · ');
    const body = `<div class="history">${road || '<span class="muted">No hands yet</span>'}</div>${mineBets ? `<div class="muted small">${mineBets}</div>` : ''}`;
    const buttons = open
      ? BAC.chipValues.filter((v) => offeredChips(BAC.chipValues, chips).includes(v)).map((v) => this.btn('chip', chipLabel(v), true, `chip chip-${v} ${v === this.chip ? 'picked' : ''}`, `data-v="${v}"`)).join('') +
        BAC_SIDES.map((k) => this.btn('bet', NAMES[k], canAdd, `side side-${k}`, `data-side="${k}"`)).join('') +
        this.btn('clear', 'Clear', total > 0 && !seat.ready) +
        this.btn('ready', 'Deal', total > 0 && !seat.ready, 'primary')
      : '';
    return { status, body, buttons, timer: s.phase === 'betting' };
  }

  protected act(act: string, el: HTMLElement) {
    if (act === 'chip') {
      this.chip = Number(el.dataset.v);
      this.renderHud();
    } else if (act === 'bet') this.send({ type: 'bet', side: el.dataset.side, amount: this.chip });
    else this.send({ type: act });
  }

  dispose() {
    this.cards.dispose();
    super.dispose();
  }
}
