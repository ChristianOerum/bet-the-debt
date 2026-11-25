import * as THREE from 'three';
import { LD, nextBid, validBid, type LiarsState, type Station } from '@casino/shared';
import type { GameViewContext } from '../GameView';
import { DICE_CHARS, makeCup, makeDie, roundTable, showDie } from '../props';
import { escapeHtml, TableView, type HudParts } from '../TableView';

interface Spot {
  cup: THREE.Group;
  dice: THREE.Mesh[];
  lift: number;
}

/** A cup and five dice in front of every player. Cups come up when someone calls "Liar!". */
export class LiarsView extends TableView<LiarsState, { dice: number[] }> {
  private spots: Spot[] = [];
  private counts = this.shape.seats.map(() => this.label(0.1));
  private bidLabel = this.label(0.16);
  private pick = { quantity: 1, face: 2 };
  private pickedFor = '';

  constructor(station: Station, ctx: GameViewContext) {
    super(station, ctx);
    this.lookFrac = 0.6;
    const top = this.shape.top;
    this.group.add(roundTable(1.15, top, '#22472f'));
    this.shape.seats.forEach((_, i) => {
      const at = this.toward(i, 0.55, top);
      const cup = makeCup();
      cup.position.copy(at);
      const dice: THREE.Mesh[] = [];
      for (let k = 0; k < LD.dice; k++) {
        const d = makeDie();
        const a = (k / LD.dice) * Math.PI * 2;
        d.position.set(at.x + Math.cos(a) * 0.07, top + 0.04, at.z + Math.sin(a) * 0.07);
        d.visible = false;
        dice.push(d);
        this.group.add(d);
      }
      cup.visible = false;
      this.group.add(cup);
      this.spots.push({ cup, dice, lift: 0 });
    });
  }

  protected sync() {
    const s = this.state!;
    const top = this.shape.top;
    const mine = this.mySeat();
    s.seats.forEach((seat, i) => {
      const spot = this.spots[i];
      const playing = !!seat && seat.inGame && (seat.count > 0 || s.phase === 'reveal');
      spot.cup.visible = playing;
      const shown = s.phase === 'reveal' ? s.reveal?.dice[i] : i === mine && s.phase === 'bidding' ? this.secret?.dice : null;
      spot.dice.forEach((d, k) => {
        const v = shown?.[k];
        d.visible = playing && v !== undefined;
        if (v !== undefined) showDie(d, v, k * 1.3 + i);
      });
      const lbl = this.counts[i];
      if (seat?.inGame) {
        lbl.set(seat.count > 0 ? '●'.repeat(seat.count) + '○'.repeat(LD.dice - seat.count) : 'out', seat.count > 0 ? '#f6ead2' : '#b9a888');
        const p = this.toward(i, 0.55, top + 0.42);
        lbl.sprite.position.copy(p);
      } else lbl.set('');
    });
    const b = s.phase === 'reveal' ? s.reveal?.bid : s.bid;
    if (b) {
      this.bidLabel.set(`${s.seats[b.seat]?.name ?? '?'}: ${b.quantity} × ${DICE_CHARS[b.face]}`, '#2a1a08', '#e0b25a');
    } else if (s.phase === 'over' && s.winner !== null) {
      this.bidLabel.set(`${s.seats[s.winner]?.name ?? '?'} wins the pot`, '#12331f', '#7be3a4');
    } else this.bidLabel.set('');
    this.bidLabel.sprite.position.set(0, top + 0.55, 0);
  }

  protected animate(dt: number) {
    const s = this.state;
    const up = s?.phase === 'reveal';
    for (const [i, spot] of this.spots.entries()) {
      // Your own cup tips back so you can peek; everyone's lifts on a reveal.
      const target = up ? 0.35 : i === this.mySeat() && s?.phase === 'bidding' ? 0.18 : 0;
      spot.lift += (target - spot.lift) * (1 - Math.exp(-dt * 6));
      spot.cup.position.y = this.shape.top + spot.lift;
      spot.cup.rotation.x = i === this.mySeat() && !up ? -spot.lift * 2 : 0;
    }
  }

  protected hudParts(mine: number): HudParts {
    const s = this.state!;
    const seat = s.seats[mine]!;
    const myDice = this.secret?.dice ?? [];
    const diceHtml = myDice.length ? `<div class="dice-row">${myDice.map((d) => `<span>${DICE_CHARS[d]}</span>`).join('')}</div>` : '';
    if (s.phase === 'waiting') {
      const seated = s.seats.filter((x) => x && !x.gone).length;
      return {
        status: seat.ready ? 'Waiting for everyone at the table…' : "Liar's Dice",
        body: `<div class="muted small">Buy-in <b>${LD.stake}</b>, winner takes the pot. Bid how many of a face are on the whole table (ones are wild), or call the last bid a lie. Wrong means you lose a die.${seated < 2 ? ' You need someone to play with.' : ''}</div>`,
        buttons: seat.ready ? this.btn('unready', 'Not yet') : this.btn('ready', `I'm in (${LD.stake})`, this.ctx.getChips() >= LD.stake, 'primary'),
      };
    }
    if (s.phase === 'reveal' && s.reveal) {
      const r = s.reveal;
      const was = r.count >= r.bid.quantity;
      return {
        status: `${r.count} × ${DICE_CHARS[r.bid.face]} on the table. ${was ? 'The bid was good.' : 'It was a lie!'}`,
        body: `<div>${this.name(r.loser)} lose${r.loser === mine ? '' : 's'} a die.</div>`,
      };
    }
    if (s.phase === 'over') {
      return { status: s.winner === mine ? `You win the pot! <b class="good">+${s.seats.filter((x) => x?.inGame).length * LD.stake}</b>` : `${this.name(s.winner)} wins the pot.` };
    }
    if (!seat.inGame || seat.count === 0) return { status: 'You are out of dice. Watching…' };
    const pot = `<div class="muted small">Pot ${s.pot} · ${s.totalDice} dice on the table</div>`;
    if (s.turn !== mine) return { status: `${this.name(s.turn)} is thinking…`, body: diceHtml + pot, timer: true };

    // Keep the picker sensible: reset it to the smallest legal bid when the bid changes.
    const key = `${s.bid?.quantity}:${s.bid?.face}:${s.bid?.seat}`;
    if (key !== this.pickedFor) {
      this.pickedFor = key;
      this.pick = nextBid(s.bid);
    }
    const ok = validBid(s.bid, this.pick.quantity, this.pick.face, s.totalDice);
    const faces = [2, 3, 4, 5, 6].map((f) => this.btn('face', DICE_CHARS[f], true, `die ${f === this.pick.face ? 'picked' : ''}`, `data-f="${f}"`)).join('');
    const body =
      diceHtml +
      (s.bid ? `<div>Bid to beat: <b>${s.bid.quantity} × ${DICE_CHARS[s.bid.face]}</b> (${escapeHtml(s.seats[s.bid.seat]?.name ?? '')})</div>` : '<div>Open the bidding.</div>') +
      `<div class="picker">${this.btn('less', '−', this.pick.quantity > 1)}<b class="qty">${this.pick.quantity}</b>${this.btn('more', '+', this.pick.quantity < s.totalDice)}<span class="times">×</span>${faces}</div>` +
      pot;
    const buttons = this.btn('bid', `Bid ${this.pick.quantity} × ${DICE_CHARS[this.pick.face]}`, ok, 'primary') + (s.bid ? this.btn('liar', 'Liar!', true, 'danger') : '');
    return { status: 'Your turn', body, buttons, timer: true };
  }

  protected act(act: string, el: HTMLElement) {
    if (act === 'less') this.pick.quantity = Math.max(1, this.pick.quantity - 1);
    else if (act === 'more') this.pick.quantity++;
    else if (act === 'face') this.pick.face = Number(el.dataset.f);
    else if (act === 'bid') this.send({ type: 'bid', quantity: this.pick.quantity, face: this.pick.face });
    else this.send({ type: act });
    this.renderHud();
  }
}
