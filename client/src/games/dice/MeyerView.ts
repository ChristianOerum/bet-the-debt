import * as THREE from 'three';
import { canAnnounce, MEYER_ORDER, meyerName, meyerValue, MY, type MeyerSecret, type MeyerState, type Station } from '@casino/shared';
import type { GameViewContext } from '../GameView';
import { DICE_CHARS, makeCup, makeDie, roundTable, showDie } from '../props';
import { TableView, type HudParts } from '../TableView';

/** One cup and two dice, passed round the table. */
export class MeyerView extends TableView<MeyerState, MeyerSecret> {
  private cup = makeCup('#2f3a5a');
  private dice = [makeDie('#c8263b', '#fff6e8'), makeDie('#c8263b', '#fff6e8')];
  private cupAt = new THREE.Vector3();
  private lift = 0;
  private lives = this.shape.seats.map(() => this.label(0.1));
  private callLabel = this.label(0.16);

  constructor(station: Station, ctx: GameViewContext) {
    super(station, ctx);
    this.lookFrac = 0.6;
    const top = this.shape.top;
    this.group.add(roundTable(0.95, top, '#3a1f4a'));
    this.cup.position.set(0, top, 0);
    this.group.add(this.cup);
    for (const d of this.dice) {
      d.visible = false;
      this.group.add(d);
    }
    this.cupAt.set(0, top, 0);
  }

  protected sync() {
    const s = this.state!;
    const top = this.shape.top;
    // The cup sits in front of whoever has it.
    const holder = s.turn ?? s.reveal?.caller ?? null;
    if (holder !== null) this.cupAt.copy(this.toward(holder, 0.5, top));
    else this.cupAt.set(0, top, 0);

    const shown = s.phase === 'reveal' ? s.reveal?.dice : this.secret?.dice;
    this.dice.forEach((d, k) => {
      const v = shown?.[k];
      d.visible = v !== undefined;
      if (v !== undefined) showDie(d, v, k * 2.1);
    });

    s.seats.forEach((seat, i) => {
      const l = this.lives[i];
      if (seat?.inGame) {
        l.set(seat.lives > 0 ? '♥'.repeat(seat.lives) + '♡'.repeat(Math.max(0, MY.lives - seat.lives)) : 'out', seat.lives > 0 ? '#ff8fab' : '#b9a888');
        l.sprite.position.copy(this.toward(i, 0.45, top + 0.4));
      } else l.set('');
    });

    if (s.phase === 'reveal' && s.reveal) {
      const r = s.reveal;
      this.callLabel.set(`Said ${meyerName(r.announced)}, had ${meyerName(meyerValue(...r.dice))}`, '#2a1a08', r.truthful ? '#7be3a4' : '#ff8f7a');
    } else if (s.announced) {
      this.callLabel.set(`${s.seats[s.announced.seat]?.name ?? '?'}: ${meyerName(s.announced.value)}`, '#2a1a08', '#e0b25a');
    } else if (s.phase === 'over' && s.winner !== null) {
      this.callLabel.set(`${s.seats[s.winner]?.name ?? '?'} wins the pot`, '#12331f', '#7be3a4');
    } else this.callLabel.set('');
    this.callLabel.sprite.position.set(0, top + 0.6, 0);
  }

  protected animate(dt: number) {
    const k = 1 - Math.exp(-dt * 6);
    const s = this.state;
    const peek = s?.phase === 'announcing' && s.turn === this.mySeat();
    const target = s?.phase === 'reveal' ? 0.38 : peek ? 0.2 : 0;
    this.lift += (target - this.lift) * k;
    this.cup.position.lerp(new THREE.Vector3(this.cupAt.x, this.shape.top + this.lift, this.cupAt.z), k);
    this.dice.forEach((d, i) => d.position.set(this.cup.position.x + (i - 0.5) * 0.09, this.shape.top + 0.04, this.cup.position.z));
  }

  protected hudParts(mine: number): HudParts {
    const s = this.state!;
    const seat = s.seats[mine]!;
    if (s.phase === 'waiting') {
      const seated = s.seats.filter((x) => x && !x.gone).length;
      return {
        status: seat.ready ? 'Waiting for everyone at the table…' : 'Meyer',
        body: `<div class="muted small">Buy-in <b>${MY.stake}</b>, ${MY.lives} lives each, winner takes the pot. Roll in secret, say what you rolled (or lie), pass it on. Beat the last call or call the bluff. Meyer (2-1) beats everything; doubting a real Meyer costs two lives.${seated < 2 ? ' You need someone to play with.' : ''}</div>`,
        buttons: seat.ready ? this.btn('unready', 'Not yet') : this.btn('ready', `I'm in (${MY.stake})`, this.ctx.getChips() >= MY.stake, 'primary'),
      };
    }
    if (s.phase === 'reveal' && s.reveal) {
      const r = s.reveal;
      return {
        status: r.truthful ? 'It was true!' : 'Caught lying!',
        body: `<div>${this.name(r.loser)} lose${r.loser === mine ? '' : 's'} ${r.lost === 2 ? 'two lives' : 'a life'}.</div>`,
      };
    }
    if (s.phase === 'over') return { status: s.winner === mine ? 'You win the pot!' : `${this.name(s.winner)} wins the pot.` };
    if (!seat.inGame || seat.lives === 0) return { status: 'You are out. Watching…' };
    const said = s.announced ? `<div>Last call: <b>${meyerName(s.announced.value)}</b> (${this.name(s.announced.seat)})</div>` : '';
    if (s.turn !== mine) return { status: `${this.name(s.turn)} has the cup…`, body: said, timer: true };

    if (s.phase === 'deciding') {
      return {
        status: 'Do you believe it?',
        body: said,
        buttons: this.btn('believe', 'Believe it and roll', true, 'primary') + this.btn('lie', 'Liar!', true, 'danger'),
        timer: true,
      };
    }
    if (s.phase === 'rolling') {
      return { status: s.announced ? `Roll, and beat ${meyerName(s.announced.value)}` : 'Your roll', body: said, buttons: this.btn('roll', 'Roll the dice <kbd>Space</kbd>', true, 'primary'), timer: true };
    }
    // announcing: you have rolled and must say something
    const dice = this.secret?.dice;
    const truth = dice ? meyerValue(...dice) : null;
    const prev = s.announced?.value ?? null;
    const options = MEYER_ORDER.filter((v) => canAnnounce(prev, v));
    const truthOk = truth !== null && canAnnounce(prev, truth);
    const body =
      (dice ? `<div class="dice-row">${dice.map((d) => `<span>${DICE_CHARS[d]}</span>`).join('')}</div><div>You rolled <b>${meyerName(truth!)}</b>${truthOk ? '' : ', which does not beat the last call. Time to lie.'}</div>` : '') +
      said +
      `<div class="calls">${options.map((v) => this.btn('announce', meyerName(v).replace('!', ''), true, v === truth ? 'picked' : '', `data-v="${v}"`)).join('')}</div>`;
    return { status: 'What do you say you rolled?', body, buttons: truthOk ? this.btn('announce', 'Tell the truth', true, 'primary', `data-v="${truth}"`) : '', timer: true, wide: true };
  }

  protected act(act: string, el: HTMLElement) {
    if (act === 'announce') this.send({ type: 'announce', value: Number(el.dataset.v) });
    else this.send({ type: act });
  }

  protected onKey(e: KeyboardEvent) {
    if (e.code === 'Space' && this.state?.phase === 'rolling' && this.state.turn === this.mySeat()) {
      e.preventDefault();
      this.send({ type: 'roll' });
    }
  }
}
