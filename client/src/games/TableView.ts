import * as THREE from 'three';
import { SHAPES, seatWorld, type Station, type TableShape } from '@casino/shared';
import type { Pose } from '../world/avatars';
import { buildCharacter, disposeObject, partsOf, updateArms } from '../world/character';
import { TextSprite } from '../world/labels';
import type { GameView, GameViewContext, SeatSpot } from './GameView';
import { addChair } from './props';

export interface BaseSeat {
  playerId: number;
  name: string;
  gone?: boolean;
}
export interface BaseState {
  seats: (BaseSeat | null)[];
  timeLeftMs?: number | null;
  timerMs?: number;
}

export interface HudParts {
  /** The big line at the top: whose turn, what you won. HTML. */
  status: string;
  /** Anything in between: your dice, your bets, a hint. HTML. */
  body?: string;
  /** The buttons. HTML. */
  buttons?: string;
  /** Show the countdown bar. */
  timer?: boolean;
  /** Extra CSS class on the panel, for games that need a wider one. */
  wide?: boolean;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * What every table view shares: the chairs, an optional dealer, sitting down,
 * the camera when seated, and the panel of buttons at the bottom of the screen.
 * A game fills in its table, how state turns into 3D, and its buttons.
 */
export abstract class TableView<S extends BaseState, Secret = unknown> implements GameView {
  readonly group = new THREE.Group();
  protected state: S | null = null;
  protected secret: Secret | null = null;
  protected readonly shape: TableShape;
  protected dealer: THREE.Group | null = null;
  /** What the seated camera looks at, in table coordinates (default: the middle). */
  protected focus = new THREE.Vector3(0, 0, 0);
  protected lookFrac = 0.72;
  protected eyeY = 1.74;
  protected lookY = 0.5;
  private cushions: THREE.MeshLambertMaterial[] = [];
  private hud = document.createElement('div');
  private hudHtml = '';
  private timerBar: HTMLElement | null = null;
  private deadline: number | null = null;
  private timerTotal = 1;
  private labels: TextSprite[] = [];

  constructor(
    readonly station: Station,
    protected ctx: GameViewContext,
  ) {
    this.shape = SHAPES[station.type];
    this.group.position.set(station.x, 0, station.z);
    this.group.rotation.y = station.rot;
    for (const s of this.shape.seats) this.cushions.push(addChair(this.group, s));
    if (this.shape.dealer) {
      const d = buildCharacter('', 'dealer');
      d.position.set(this.shape.dealer.x, 0, this.shape.dealer.z);
      const p = partsOf(d);
      p.hands[0].position.set(-0.3, 1.0, 0.36);
      p.hands[1].position.set(0.3, 1.0, 0.36);
      updateArms(p);
      this.group.add(d);
      this.dealer = d;
    }
    this.hud.className = 'bj-panel';
    this.hud.hidden = true;
    this.hud.addEventListener('click', this.onClick);
    ctx.hudRoot.appendChild(this.hud);
    window.addEventListener('keydown', this.onKeyDown);
  }

  // ---- what each game provides ----------------------------------------------------

  /** Make the 3D match the state (and secret). Called on every update. */
  protected abstract sync(): void;
  /** The panel at the bottom of the screen, for the seated player. */
  protected abstract hudParts(mine: number): HudParts;
  /** A button with data-act was clicked. */
  protected abstract act(act: string, el: HTMLElement): void;
  /** Per-frame animation. */
  protected animate(_dt: number, _time: number): void {}
  /** A key while seated (not typing). */
  protected onKey(_e: KeyboardEvent): void {}

  // ---- GameView ----------------------------------------------------------------

  setState(raw: unknown) {
    this.state = raw as S;
    const s = this.state;
    this.deadline = s.timeLeftMs == null ? null : performance.now() + s.timeLeftMs;
    this.timerTotal = s.timerMs || 1;
    if (this.mySeat() < 0) this.secret = null;
    this.sync();
    this.renderHud();
  }

  setSecret(secret: unknown) {
    this.secret = secret as Secret;
    if (this.state) this.sync();
    this.renderHud();
  }

  refresh() {
    this.renderHud();
  }

  seats(): SeatSpot[] {
    return this.shape.seats.map((_, index) => ({ index, ...seatWorld(this.station, index), occupied: !!this.state?.seats[index] }));
  }

  seatedPlayers(): Map<number, Pose> {
    const out = new Map<number, Pose>();
    this.state?.seats.forEach((s, i) => {
      if (s && !s.gone) out.set(s.playerId, seatWorld(this.station, i));
    });
    return out;
  }

  mySeat(): number {
    return this.state?.seats.findIndex((s) => s?.playerId === this.ctx.myId && !s.gone) ?? -1;
  }

  cameraPose(seat: number) {
    const s = this.shape.seats[seat];
    const k = this.lookFrac;
    this.group.updateMatrixWorld();
    return {
      pos: this.group.localToWorld(new THREE.Vector3(s.x, this.eyeY, s.z)),
      look: this.group.localToWorld(new THREE.Vector3(s.x + (this.focus.x - s.x) * k, this.lookY, s.z + (this.focus.z - s.z) * k)),
    };
  }

  highlightSeat(seat: number | null) {
    this.cushions.forEach((m, i) => m.emissive.set(i === seat ? '#8a5a12' : '#000000'));
  }

  update(dt: number, time: number) {
    this.animate(dt, time);
    if (this.timerBar) {
      const left = this.deadline === null ? 0 : Math.max(0, this.deadline - performance.now());
      this.timerBar.style.width = `${Math.min(100, (left / this.timerTotal) * 100)}%`;
      this.timerBar.classList.toggle('low', left < 5000);
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    this.hud.remove();
    for (const l of this.labels) l.dispose();
    this.group.removeFromParent();
    disposeObject(this.group);
  }

  // ---- helpers for games --------------------------------------------------------------

  protected send(action: unknown) {
    this.ctx.send(action);
  }

  /** A floating label that belongs to this table (cleaned up with it). */
  protected label(height: number): TextSprite {
    const l = new TextSprite(height);
    this.labels.push(l);
    this.group.add(l.sprite);
    return l;
  }

  /** A seat's position pulled toward the middle of the table by `frac` (0 = the chair, 1 = the middle). */
  protected toward(seat: number, frac: number, y: number): THREE.Vector3 {
    const s = this.shape.seats[seat];
    return new THREE.Vector3(s.x * (1 - frac), y, s.z * (1 - frac));
  }

  protected name(seat: number | null | undefined): string {
    if (seat === null || seat === undefined) return '';
    return seat === this.mySeat() ? 'You' : escapeHtml(this.state?.seats[seat]?.name ?? 'Someone');
  }

  protected btn(act: string, label: string, enabled = true, cls = '', extra = '') {
    return `<button class="${cls}" data-act="${act}" ${extra} ${enabled ? '' : 'disabled'}>${label}</button>`;
  }

  protected renderHud() {
    const mine = this.mySeat();
    if (!this.state || mine < 0) {
      this.hud.hidden = true;
      this.hudHtml = '';
      this.timerBar = null;
      return;
    }
    const p = this.hudParts(mine);
    const html =
      `<div class="bj-status">${p.status}</div>` +
      `<div class="bj-timer" ${p.timer ? '' : 'hidden'}><i></i></div>` +
      (p.body ? `<div class="bj-body">${p.body}</div>` : '') +
      `<div class="bj-buttons">${p.buttons ?? ''}</div>` +
      `<button class="bj-leave" data-act="leave">Leave table</button>`;
    this.hud.hidden = false;
    this.hud.classList.toggle('wide', !!p.wide);
    if (html !== this.hudHtml) {
      this.hudHtml = html;
      this.hud.innerHTML = html;
      this.timerBar = this.hud.querySelector<HTMLElement>('.bj-timer i');
    }
  }

  private onClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    if (el.dataset.act === 'leave') this.ctx.leave();
    else this.act(el.dataset.act!, el);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT' || e.repeat || this.mySeat() < 0) return;
    this.onKey(e);
  };
}
