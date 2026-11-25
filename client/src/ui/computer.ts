// The computer on the desk at home. It runs "LuckyOS": a login screen, a desktop, your bank
// account (where the money you cash out ends up) and a web shop that is not open yet.
import { iconHtml } from './icons';
import {
  cannotBuy,
  GAME_NAME,
  shopItem,
  SHOP_CATEGORIES,
  SHOP_ITEMS,
  SHOP_NAME,
  type BankStatement,
  type PurchaseResult,
  type ShopCategory,
  type ShopItem,
} from '@casino/shared';

export interface ComputerEvents {
  /** The bank's website wants your statement. */
  loadBank(): Promise<BankStatement>;
  /** Checkout: the server takes the money (or does not). */
  buy(itemId: string): Promise<PurchaseResult>;
  /** Put on exactly these clothes. */
  wear(outfit: string[]): void;
  /** It opened (true) or shut down (false). */
  changed(open: boolean): void;
}

/** Who is logged in, and what they have. */
export interface ComputerUser {
  name: string;
  color: string;
  cash: number;
  owned: string[];
  outfit: string[];
  aptLevel: number;
}

type View = 'login' | 'desktop' | 'bank' | 'shop';

/** What the shop says after a purchase. */
function thanks(item: ShopItem): string {
  if (item.level !== undefined) return `Welcome to your new home! The removal men have already been. (They broke a mug.)`;
  if (item.slot) return `Thank you for your order! You are wearing it already: ${item.name}.`;
  return `Thank you for your order! Delivered to your flat: ${item.name}.`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const money = (n: number) => `$${n.toLocaleString('en-US')}`;
const signed = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : money(0));
const when = (ms: number) => {
  const d = new Date(ms);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

export class Computer {
  private root = document.querySelector<HTMLElement>('#pc')!;
  private screen = document.querySelector<HTMLElement>('#pc-screen')!;
  private view: View = 'login';
  private user: ComputerUser = { name: '', color: '#ffffff', cash: 0, owned: [], outfit: [], aptLevel: 1 };
  private shopTab: ShopCategory = 'clothes';
  private bank: BankStatement | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  /** The shop's last word: "thank you for your order", or why not. */
  private note: { text: string; ok: boolean } | null = null;
  /** An order is going through. */
  private busy = false;

  constructor(private events: ComputerEvents) {
    this.screen.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-pc]');
      if (el) this.act(el.dataset.pc!, el.dataset.arg);
    });
    this.screen.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && (e.target as HTMLElement).id === 'pc-pass') this.act('login');
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  /** Sit down at the computer. It always starts at the login screen. */
  open(user: ComputerUser) {
    this.user = { ...user, owned: [...user.owned], outfit: [...user.outfit] };
    this.bank = null;
    this.note = null;
    this.root.hidden = false;
    this.show('login');
    this.clock = setInterval(() => this.tick(), 10_000);
    this.events.changed(true);
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    if (this.clock) clearInterval(this.clock);
    this.clock = null;
    this.events.changed(false);
  }

  /** Your cash changed while the computer was on. */
  setCash(cash: number) {
    this.user.cash = cash;
    if (this.isOpen && this.view !== 'login') this.show(this.view);
  }

  private act(what: string, arg?: string) {
    switch (what) {
      case 'login':
        this.screen.querySelector('.pc-login')?.classList.add('working');
        setTimeout(() => this.isOpen && this.show('desktop'), 700); // the hard drive has to spin up
        break;
      case 'logoff':
        this.show('login');
        break;
      case 'off':
        this.close();
        break;
      case 'open':
        this.show(arg as View);
        if (arg === 'bank') void this.refreshBank();
        break;
      case 'close':
        this.show('desktop');
        break;
      case 'tab':
        this.shopTab = arg as ShopCategory;
        this.note = null;
        this.show('shop');
        break;
      case 'buy':
        void this.buy(arg!);
        break;
      case 'wear': {
        // Put it on, swapping out whatever was in the same place.
        const item = shopItem(arg!);
        if (!item?.slot) break;
        this.user.outfit = [...this.user.outfit.filter((id) => shopItem(id)?.slot !== item.slot), item.id];
        this.events.wear(this.user.outfit);
        this.show('shop');
        break;
      }
      case 'takeoff':
        this.user.outfit = this.user.outfit.filter((id) => id !== arg);
        this.events.wear(this.user.outfit);
        this.show('shop');
        break;
    }
  }

  private async buy(itemId: string) {
    if (this.busy) return;
    const item = shopItem(itemId);
    if (!item) return;
    this.busy = true;
    this.note = { text: 'Processing your order…', ok: true };
    this.show('shop');
    try {
      const r = await this.events.buy(itemId);
      Object.assign(this.user, { cash: r.cash, owned: r.owned, aptLevel: r.aptLevel });
      if (r.ok && item.slot) {
        // New clothes go straight on.
        this.user.outfit = [...this.user.outfit.filter((id) => shopItem(id)?.slot !== item.slot), item.id];
        this.events.wear(this.user.outfit);
      }
      this.note = r.ok ? { text: thanks(item), ok: true } : { text: r.error ?? 'Your order did not go through.', ok: false };
    } catch {
      this.note = { text: 'Could not reach the shop. Nothing was charged.', ok: false };
    }
    this.busy = false;
    this.bank = null; // the statement has a new line on it
    if (this.isOpen && this.view === 'shop') this.show('shop');
  }

  private async refreshBank() {
    try {
      this.bank = await this.events.loadBank();
      this.user.cash = this.bank.cash;
    } catch {
      this.bank = null;
    }
    if (this.view === 'bank') this.show('bank');
  }

  private tick() {
    const c = this.screen.querySelector('.pc-clock');
    if (c) c.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  private show(view: View) {
    this.view = view;
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (view === 'login') {
      this.screen.innerHTML = `
        <div class="pc-login">
          <div class="pc-big-clock pc-clock">${time}</div>
          <div class="pc-os">LuckyOS 95</div>
          <div class="pc-avatar" style="background:${esc(this.user.color)}"></div>
          <div class="pc-user">${esc(this.user.name)}</div>
          <input id="pc-pass" type="password" placeholder="Password" autocomplete="off" />
          <button class="pc-btn primary" data-pc="login">Log in</button>
          <div class="pc-sticky">password:<br /><b>password</b></div>
          <button class="pc-btn ghost pc-power" data-pc="off">⏻ Shut down</button>
        </div>`;
      setTimeout(() => this.screen.querySelector<HTMLInputElement>('#pc-pass')?.focus(), 30);
      return;
    }
    const icons = `
      <div class="pc-icons">
        <button class="pc-icon" data-pc="open" data-arg="bank"><span>🏦</span>Lucky Bank</button>
        <button class="pc-icon" data-pc="open" data-arg="shop"><span>🛒</span>${SHOP_NAME}</button>
        <button class="pc-icon" disabled><span>🗑️</span>Recycle bin</button>
        <button class="pc-icon" disabled><span>📁</span>Taxes (do not open)</button>
      </div>`;
    const taskbar = `
      <div class="pc-taskbar">
        <span class="pc-start">🍀 LuckyOS</span>
        <span class="pc-task">${view === 'bank' ? '🏦 Lucky Bank' : view === 'shop' ? `🛒 ${SHOP_NAME}` : ''}</span>
        <span class="pc-spacer"></span>
        <span class="pc-tray">${money(this.user.cash)}</span>
        <span class="pc-clock">${time}</span>
        <button class="pc-btn small" data-pc="logoff">Log off</button>
        <button class="pc-btn small" data-pc="off">⏻</button>
      </div>`;
    const win = view === 'bank' ? this.bankWindow() : view === 'shop' ? this.shopWindow() : '';
    this.screen.innerHTML = `<div class="pc-desktop"><div class="pc-wallpaper">${esc(GAME_NAME)}</div>${icons}${win}${taskbar}</div>`;
  }

  private window(title: string, icon: string, body: string) {
    return `
      <div class="pc-window">
        <div class="pc-titlebar"><span>${icon} ${title}</span><button class="pc-x" data-pc="close" title="Close">✕</button></div>
        <div class="pc-addr">🔒 https://${title.toLowerCase().replace(/[^a-z.]+/g, '')}${title.includes('.') ? '' : '.com'}/</div>
        <div class="pc-body">${body}</div>
      </div>`;
  }

  private bankWindow() {
    const b = this.bank;
    if (!b) return this.window('Lucky Bank', '🏦', '<div class="pc-loading">Connecting to Lucky Bank…</div>');
    const rows = b.history.length
      ? b.history
          .map(
            (h) => `<tr><td>${when(h.at)}</td><td>${esc(h.note)}</td><td class="${h.amount > 0 ? 'in' : h.amount < 0 ? 'out' : ''}">${signed(h.amount)}</td><td>${money(h.balance)}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4" class="pc-empty">Nothing yet. Cash out at the casino and it lands here.</td></tr>';
    return this.window(
      'Lucky Bank',
      '🏦',
      `<div class="bank-head">
         <div><div class="bank-name">Lucky Arms Credit Union</div><div class="bank-sub">"We never ask where it came from."</div></div>
         <div class="bank-acct"><div>${esc(b.name)}</div><div>${esc(b.account)}</div></div>
       </div>
       <div class="bank-balance"><span>Available balance</span><b>${money(b.cash)}</b></div>
       <table class="bank-table"><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Balance</th></tr></thead><tbody>${rows}</tbody></table>
       <p class="bank-small">Money you cash out at the casino, after paying back the house's 500 chips, is paid into this account. It is yours to keep between runs.</p>`,
    );
  }

  private shopWindow() {
    const tabs = SHOP_CATEGORIES.map((c) => `<button class="shop-tab ${c.id === this.shopTab ? 'on' : ''}" data-pc="tab" data-arg="${c.id}">${c.label}</button>`).join('');
    const cards = SHOP_ITEMS.filter((i) => i.category === this.shopTab)
      .map(
        (i) => `
        <div class="shop-card ${this.ownsIt(i) ? 'owned' : ''}">
          <div class="shop-pic" style="background:${i.tint}">${iconHtml(i.id, i.icon, 'shop-ico')}</div>
          <div class="shop-name">${esc(i.name)}</div>
          <div class="shop-blurb">${esc(i.blurb)}</div>
          <div class="shop-foot"><b class="${!this.ownsIt(i) && i.price > this.user.cash ? 'dear' : ''}">${this.ownsIt(i) ? 'Yours' : money(i.price)}</b>${this.button(i)}</div>
        </div>`,
      )
      .join('');
    const note = this.note ? `<div class="shop-note ${this.note.ok ? 'ok' : 'bad'}">${esc(this.note.text)}</div>` : '';
    return this.window(
      SHOP_NAME,
      '🛒',
      `<div class="shop-head"><span class="shop-logo">${SHOP_NAME}</span><span class="shop-wallet">You have <b>${money(this.user.cash)}</b></span></div>
       <div class="shop-banner">Free delivery to the Lucky Arms. Paid straight from your Lucky Bank account.</div>
       ${note}
       <div class="shop-tabs">${tabs}</div>
       <div class="shop-grid">${cards}</div>`,
    );
  }

  private ownsIt(i: ShopItem) {
    return i.level !== undefined ? this.user.aptLevel >= i.level : this.user.owned.includes(i.id);
  }

  /** Buy, wear, take off, or just a tick, depending on the item and what you have. */
  private button(i: ShopItem) {
    if (this.ownsIt(i)) {
      if (i.slot) {
        return this.user.outfit.includes(i.id)
          ? `<button class="pc-btn small" data-pc="takeoff" data-arg="${i.id}">Take off</button>`
          : `<button class="pc-btn small primary" data-pc="wear" data-arg="${i.id}">Wear</button>`;
      }
      return `<button class="pc-btn small" disabled>${i.level !== undefined ? '✓ You live here' : i.category === 'weapons' ? '✓ In your pocket' : '✓ In your flat'}</button>`;
    }
    const why = cannotBuy(i, this.user);
    return `<button class="pc-btn small primary" data-pc="buy" data-arg="${i.id}" ${why || this.busy ? `disabled title="${esc(why ?? 'One moment…')}"` : ''}>Buy</button>`;
  }
}
