import { iconHtml } from './icons';
import { cashFor, DIFFICULTIES, drugInfo, GAME_NAME, heldInfo, RUN, type ChatMsg, type Effects, type HeldItem, type LobbyInfo, type RunState, type Vitals } from '@casino/shared';

export interface DialogButton {
  label: string;
  act: string;
  primary?: boolean;
  danger?: boolean;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export interface HudEvents {
  chat(text: string): void;
  /** The chat box closed; a good moment to grab the mouse again. */
  chatClosed(): void;
  /** Esc menu: back to the game. */
  resume(): void;
  leaveTable(): void;
  leaveLobby(): void;
  logout(): void;
  /** The Esc menu opened or closed. */
  menuChanged(open: boolean): void;
}

/** Everything drawn on top of the 3D view that is not part of a specific game. */
export class Hud {
  readonly gameRoot = $('#game-hud');
  private root = $('#hud');
  private chips = $('#chips');
  private run = $('#run');
  private prompt = $('#prompt');
  private clickHint = $('#click-hint');
  private chatLog = $('#chat-log');
  private chatInput = $<HTMLInputElement>('#chat-input');
  private toasts = $('#toasts');
  private flashEl = $('#flash');
  private death = $('#death');
  private menu = $('#menu');
  private dialog = $('#dialog');
  private dialogHandler: ((act: string) => void) | null = null;
  private promptText = '';
  private chipCount = 0;
  private runState: RunState | null = null;
  private inLobby = false;

  constructor(private events: HudEvents) {
    $('#menu-title').textContent = GAME_NAME;
    this.dialog.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-dlg]')?.dataset.dlg;
      if (!act) return;
      const handler = this.dialogHandler;
      this.closeDialog(act === 'cancel');
      handler?.(act);
    });
    this.dialog.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
        e.preventDefault();
        this.dialog.querySelector<HTMLButtonElement>('button.primary')?.click();
      }
    });
    this.menu.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-menu]')?.dataset.menu;
      if (act === 'resume') this.closeMenu(true);
      else if (act === 'help') $('#menu-help').hidden = !$('#menu-help').hidden;
      else if (act === 'controls') $('#menu-controls').hidden = !$('#menu-controls').hidden;
      else if (act === 'leave') {
        this.closeMenu(false);
        events.leaveTable();
      } else if (act === 'lobby') {
        this.closeMenu(false);
        events.leaveLobby();
      } else if (act === 'logout') {
        this.closeMenu(false);
        events.logout();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (e.code === 'Escape') {
        // Chat swallows its own Escape (see below), so this is the menu key.
        e.preventDefault();
        if (this.overlay?.isOpen) this.overlay.close();
        else if (this.dialogOpen) this.closeDialog(true);
        else if (this.menuOpen) this.closeMenu(true);
        else this.openMenu();
        return;
      }
      if (e.code !== 'Enter' || this.menuOpen || this.dialogOpen || this.overlay?.isOpen || document.activeElement === this.chatInput) return;
      e.preventDefault();
      if (document.pointerLockElement) document.exitPointerLock();
      this.chatInput.focus();
    });
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' && e.code !== 'Escape') return;
      // One press of Escape closes the chat and nothing else.
      e.preventDefault();
      e.stopPropagation();
      const text = this.chatInput.value.trim();
      if (e.code === 'Enter' && text) events.chat(text);
      this.chatInput.value = '';
      this.chatInput.blur();
      events.chatClosed();
    });
  }

  get menuOpen() {
    return !this.menu.hidden;
  }

  /** Full-screen things that Esc should close first (the computer at home, the bar menu). */
  private overlays: { readonly isOpen: boolean; close(): void }[] = [];
  addOverlay(o: { readonly isOpen: boolean; close(): void }) {
    this.overlays.push(o);
  }
  private get overlay() {
    return this.overlays.find((o) => o.isOpen) ?? null;
  }
  get overlayOpen() {
    return !!this.overlay;
  }

  /** The hotbar: what is in each of your four slots, and which one you are holding. */
  setHotbar(items: (HeldItem | null)[], selected: number | null) {
    $('#hotbar').innerHTML = items
      .map((h, i) => {
        const item = h ? heldInfo(h.itemId) : null;
        const count = item?.kind === 'food' ? `<span class="hb-left">${h!.left}</span>` : '';
        const body = item ? `${iconHtml(h!.itemId, item.icon, 'hb-ico')}${count}` : '<span class="hb-fist">✊</span>';
        return `<div class="hb-slot ${selected === i ? 'on' : ''} ${item ? '' : 'empty'}" title="${item?.name ?? 'Empty: a click is a punch'}"><span class="hb-key">${i + 1}</span>${body}</div>`;
      })
      .join('');
  }

  /** Drugs working on you: an icon and the time left on each. Call every second or so. */
  setEffects(e: Effects) {
    const now = Date.now();
    $('#effects').innerHTML = (Object.entries(e) as [string, number][])
      .filter(([, until]) => until > now)
      .map(([id, until]) => {
        const d = drugInfo(id);
        const s = Math.ceil((until - now) / 1000);
        return `<span class="fx" title="${d?.name ?? id}">${iconHtml(id, d?.icon ?? '?', 'fx-ico')} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</span>`;
      })
      .join('');
  }

  /** The chance (0-1) of a hunch at your next decision. Hidden at 0 (sober, or not on a run). */
  setGutChance(chance: number) {
    const el = $('#gut-chance');
    el.hidden = chance <= 0;
    el.textContent = `🍸 gut ${Math.round(chance * 100)}%`;
    el.classList.toggle('high', chance >= 0.75);
  }

  /** Third Eye: what you can see through, at your table. Null hides it. */
  setPeek(text: string | null) {
    const el = $('#peek');
    el.hidden = !text;
    if (text) el.querySelector('pre')!.textContent = text;
  }

  /** Your body, in the corner. */
  setVitals(v: Vitals) {
    const bar = (cls: string, value: number, low: boolean) => {
      const el = this.root.querySelector<HTMLElement>(`.vbar.${cls}`)!;
      el.querySelector<HTMLElement>('b')!.style.width = `${Math.max(0, Math.min(100, value))}%`;
      el.classList.toggle('low', low);
    };
    bar('health', v.health, v.health < 30);
    bar('hunger', v.hunger, v.hunger < 15);
    bar('thirst', v.thirst, v.thirst < 15);
    bar('bladder', v.bladder, v.bladder > 80);
    const bac = $('#bac');
    bac.textContent = `${v.bac.toFixed(2)} ‰`;
    bac.className = v.bac >= 2.5 ? 'danger' : v.bac >= 1.2 ? 'drunk' : v.bac >= 0.3 ? 'tipsy' : '';
  }

  /** Eyelids: `open` 0 (shut) to 1 (wide open), over `ms`. */
  private lids(open: number, ms: number) {
    for (const lid of document.querySelectorAll<HTMLElement>('#eyelids .lid')) {
      lid.style.transition = `height ${ms}ms ease-in-out`;
      // Fully shut, the lids overlap, so no light gets in round the curved edges.
      lid.style.height = open <= 0 ? '70%' : `${(1 - open) * 52}%`;
    }
  }
  private eyeTimers: ReturnType<typeof setTimeout>[] = [];
  private eyeSteps(steps: [number, number][]) {
    for (const t of this.eyeTimers) clearTimeout(t);
    this.eyeTimers = [];
    let at = 0;
    for (const [open, ms] of steps) {
      this.eyeTimers.push(setTimeout(() => this.lids(open, ms), at));
      at += ms;
    }
  }
  /** Waking up: shut, a slit, a blink, then open. */
  eyesOpen() {
    this.lids(0, 0);
    this.eyeSteps([[0, 500], [0.35, 600], [0.05, 250], [0.6, 500], [0.2, 200], [1, 700]]);
  }
  /** Going under: heavy lids, a couple of fights to stay awake, then dark. */
  eyesClose() {
    this.eyeSteps([[0.7, 700], [0.85, 300], [0.4, 800], [0.6, 400], [0.15, 900], [0.3, 300], [0, 1100]]);
  }
  eyesReset() {
    this.eyeSteps([[1, 400]]);
  }

  /** `seated` decides whether "Leave table" is offered. */
  get dialogOpen() {
    return !this.dialog.hidden;
  }

  /** A small conversation: a title, some HTML, and buttons. `onAct` gets the button's act. */
  openDialog(title: string, bodyHtml: string, buttons: DialogButton[], onAct: (act: string) => void) {
    if (this.root.hidden) return;
    this.closeMenu(false);
    $('#dialog-title').textContent = title;
    $('#dialog-body').innerHTML = bodyHtml;
    $('#dialog-buttons').innerHTML = [...buttons, { label: 'Never mind', act: 'cancel' }]
      .map((b) => `<button class="big ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" data-dlg="${b.act}">${b.label}</button>`)
      .join('');
    this.dialogHandler = onAct;
    const wasOpen = this.dialogOpen;
    this.dialog.hidden = false;
    if (!wasOpen) this.events.menuChanged(true);
    this.dialog.querySelector<HTMLInputElement>('input')?.focus();
  }

  /** The text typed into the open dialog's input, if it has one. */
  dialogInput(): string {
    return this.dialog.querySelector<HTMLInputElement>('input')?.value ?? '';
  }

  closeDialog(resume: boolean) {
    if (!this.dialogOpen) return;
    this.dialog.hidden = true;
    this.dialogHandler = null;
    this.events.menuChanged(false);
    if (resume) this.events.resume();
  }

  setCash(cash: number) {
    $('#cash').textContent = `$${cash.toLocaleString('en-US')}`;
  }

  setLobby(info: LobbyInfo) {
    this.inLobby = !!info.code;
    $('#lobby-pill').textContent = info.code ? `Lobby ${info.code} · ${info.members.length} · ${DIFFICULTIES[info.difficulty].label}` : 'On your own';
  }

  setGhost(on: boolean) {
    document.body.classList.toggle('ghost', on);
    $('#ghost-banner').hidden = !on;
  }

  /** Black out, do something (go through a door), come back. */
  fade(during: () => void) {
    const f = $('#fade');
    f.classList.add('on');
    setTimeout(() => {
      during();
      setTimeout(() => f.classList.remove('on'), 60);
    }, 230);
  }

  openMenu(seated = this.root.classList.contains('seated')) {
    if (this.menuOpen || this.root.hidden || this.overlayOpen) return;
    $('#menu-lobby').hidden = !this.inLobby;
    $('#menu-leave').hidden = !seated;
    $('#menu-help').hidden = true;
    $('#menu-controls').hidden = true;
    this.menu.hidden = false;
    this.events.menuChanged(true);
  }

  closeMenu(resume: boolean) {
    if (!this.menuOpen) return;
    this.menu.hidden = true;
    this.events.menuChanged(false);
    if (resume) this.events.resume();
  }

  show(visible: boolean) {
    this.root.hidden = !visible;
    if (!visible) {
      this.hideDeath();
      this.menu.hidden = true;
      this.dialog.hidden = true;
      this.setGhost(false);
    }
  }

  setName(name: string, color: string) {
    const el = $('#me-name');
    el.textContent = name;
    el.style.color = color;
  }

  setChips(chips: number) {
    this.chipCount = chips;
    this.chips.textContent = chips.toLocaleString('en-US');
    this.renderRun();
  }

  /** null = not on a run (chips and round are hidden). */
  setRun(run: RunState | null) {
    this.runState = run;
    $('#chips-pill').hidden = !run;
    this.run.hidden = !run;
    this.renderRun();
  }

  /** "Round 3 · ante 110 in 2 hands", glowing red when you could not pay it right now. */
  private renderRun() {
    const r = this.runState;
    if (!r) return;
    const round = document.createElement('span');
    round.textContent = `Round ${r.round}`;
    const due = document.createElement('span');
    due.className = 'due';
    const amount = document.createElement('b');
    amount.textContent = r.ante.toLocaleString('en-US');
    due.append('ante ', amount, r.handsLeft === 1 ? ' after this hand' : ` in ${r.handsLeft} hands`);
    this.run.replaceChildren(round, due);
    // What the cashier would give you right now: the reason to stop before the next ante.
    const take = document.createElement('span');
    take.className = 'take';
    const cash = cashFor(this.chipCount);
    take.textContent = cash > 0 ? `cash out: $${cash.toLocaleString('en-US')}` : 'cash out: $0';
    take.classList.toggle('zero', cash <= 0);
    this.run.append(take);
    this.run.title = `Cash out at the cashier any time: the house takes back its ${RUN.startChips}, you keep the rest. Best run: round ${r.best} on ${DIFFICULTIES[r.bestLevel].label}.`;
    this.run.classList.toggle('short', this.chipCount - r.ante < 10);
  }

  setOnline(count: number) {
    $('#online').textContent = count === 1 ? 'Just you here' : `${count} players here`;
  }

  setSeated(seated: boolean) {
    this.root.classList.toggle('seated', seated);
  }

  /** "Press E to ..." under the crosshair (or, with `key` false, just a note). Pass null to hide it. */
  setPrompt(action: string | null, key = true) {
    const text = action ?? '';
    if (`${key}${text}` === this.promptText) return;
    this.promptText = `${key}${text}`;
    this.prompt.hidden = !text;
    this.prompt.replaceChildren();
    if (!text) return;
    if (key) {
      const k = document.createElement('kbd');
      k.textContent = 'E';
      this.prompt.append(k);
    }
    this.prompt.append(text);
  }

  setClickHint(visible: boolean) {
    this.clickHint.hidden = !visible;
  }

  addChat(msg: ChatMsg) {
    const row = document.createElement('div');
    const who = document.createElement('b');
    who.textContent = `${msg.name}: `;
    who.style.color = msg.color;
    row.append(who, msg.text);
    this.pushChat(row);
  }

  addSystem(text: string, kind: 'system' | 'obit' = 'system') {
    const row = document.createElement('div');
    row.className = kind;
    row.textContent = text;
    this.pushChat(row);
  }

  private pushChat(row: HTMLElement) {
    // Bright for a few seconds, then it fades back with the rest of the chat.
    row.classList.add('fresh');
    setTimeout(() => row.classList.remove('fresh'), 6000);
    this.chatLog.appendChild(row);
    while (this.chatLog.children.length > 30) this.chatLog.firstChild?.remove();
  }

  toast(text: string, kind: 'bad' | 'info' | 'gut' = 'bad') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = kind === 'gut' ? `🍸 Gut feeling: ${text}` : text;
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), kind === 'gut' ? 7000 : kind === 'info' ? 4500 : 3300);
  }

  /** The muzzle flash, seen from the wrong end. */
  flash() {
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth; // restart the animation
    this.flashEl.classList.add('go');
  }

  showDeath(text: string) {
    $('#death-text').textContent = text;
    this.death.hidden = false;
    this.root.classList.add('dead');
  }

  hideDeath() {
    this.death.hidden = true;
    this.root.classList.remove('dead');
  }

  /** Security has you: no crosshair, no table buttons, just the walk. */
  setEscorted(on: boolean) {
    this.root.classList.toggle('escorted', on);
  }
}
