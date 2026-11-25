// The bar's menu: food, soft drinks, beer, cocktails and shots, all paid in chips.
import { MENU, MENU_SECTIONS, type MenuItem, type MenuSection } from '@casino/shared';
import { iconHtml } from './icons';

export interface BarEvents {
  /** Order one; the server answers. */
  order(itemId: string): Promise<{ ok: boolean; error?: string }>;
  /** How many chips you have right now. */
  chips(): number;
  /** Opened or closed. */
  changed(open: boolean): void;
  /** Something to say about it ("Cheers!" or why not). */
  say(text: string, ok: boolean): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Short notes on what it does to you. */
function effects(i: MenuItem): string {
  const out: string[] = [];
  if (i.hunger) out.push(i.hunger > 0 ? `🍔 +${i.hunger}` : `🍔 ${i.hunger}`);
  if (i.thirst) out.push(i.thirst > 0 ? `💧 +${i.thirst}` : `💧 ${i.thirst}`);
  if (i.alcohol) out.push(`🍸 +${i.alcohol.toFixed(2)} ‰`);
  if (i.bladder && i.bladder >= 10) out.push('🚽 soon');
  return out.join(' · ');
}

export class BarMenu {
  private root = document.querySelector<HTMLElement>('#bar-menu')!;
  private tab: MenuSection = 'beer';
  private busy = false;

  constructor(private events: BarEvents) {
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-bar]');
      if (!el) return;
      const act = el.dataset.bar!;
      if (act === 'close') this.close();
      else if (act === 'tab') {
        this.tab = el.dataset.arg as MenuSection;
        this.render();
      } else if (act === 'order') void this.order(el.dataset.arg!);
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open() {
    this.root.hidden = false;
    this.render();
    this.events.changed(true);
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.events.changed(false);
  }

  private async order(id: string) {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await this.events.order(id);
      const item = MENU.find((m) => m.id === id);
      const drink = item && item.section !== 'food';
      if (r.ok) this.events.say(`${item?.name ?? 'That'}: in your hand. Click to ${drink ? 'drink' : 'eat'}${item?.alcohol ? '. Cheers!' : '.'}`, true);
      else this.events.say(r.error ?? 'The bartender shakes his head.', false);
    } catch {
      this.events.say('The bartender is busy.', false);
    }
    this.busy = false;
    if (this.isOpen) this.render();
  }

  private render() {
    const chips = this.events.chips();
    document.querySelector('#bar-tabs')!.innerHTML = MENU_SECTIONS.map(
      (s) => `<button class="${s.id === this.tab ? 'on' : ''}" data-bar="tab" data-arg="${s.id}">${s.label}</button>`,
    ).join('');
    document.querySelector('#bar-items')!.innerHTML = MENU.filter((m) => m.section === this.tab)
      .map(
        (m) => `
        <button class="bar-item" data-bar="order" data-arg="${m.id}" title="${esc(m.blurb)}" ${m.price > chips ? 'disabled' : ''}>
          <span class="ico">${iconHtml(m.id, m.icon)}</span><span class="nm">${esc(m.name)}</span><span class="pr">${m.price}</span>
          <span class="fx">${effects(m)}</span>
        </button>`,
      )
      .join('');
  }
}
