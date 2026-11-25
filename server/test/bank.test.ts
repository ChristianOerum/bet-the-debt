import { describe, expect, it } from 'vitest';
import { cannotBuy, shopItem, SHOP_CATEGORIES, SHOP_ITEMS, validOutfit } from '@casino/shared';
import { accountNumber } from '../src/hub';
import { SqliteStore } from '../src/store/SqliteStore';

describe('the bank', () => {
  it('writes every cash-out on the statement, newest first, with the balance after', async () => {
    const store = new SqliteStore(':memory:');
    const u = (await store.createUser('Saver', 'hash', '#fff'))!;
    await store.addCash(u.id, 200, 'Casino cash-out: 700 chips in round 2');
    await store.addCash(u.id, 0, 'Casino cash-out: 300 chips in round 1');
    await store.addCash(u.id, 1250, 'Casino cash-out: 1750 chips in round 5');
    const history = await store.bankHistory(u.id, 10);
    expect(history.map((h) => [h.amount, h.balance])).toEqual([
      [1250, 1450],
      [0, 200],
      [200, 200],
    ]);
    expect((await store.getUserById(u.id))!.cash).toBe(1450);
    // Somebody else's statement is their own.
    const other = (await store.createUser('Other', 'hash', '#fff'))!;
    expect(await store.bankHistory(other.id, 10)).toEqual([]);
    store.close();
  });

  it('keeps each best run with its level, and ranks Hard rounds above the same rounds on Easy', async () => {
    const store = new SqliteStore(':memory:');
    const easy = (await store.createUser('Easy', 'hash', '#fff'))!;
    const hard = (await store.createUser('Hard', 'hash', '#fff'))!;
    await store.setBest(easy.id, 7, 'easy');
    await store.setBest(hard.id, 5, 'hard');
    const board = await store.leaderboard(5);
    expect(board.slice(0, 2).map((r) => [r.name, r.best, r.level])).toEqual([
      ['Hard', 5, 'hard'], // 5 + 4 beats 7 + 0
      ['Easy', 7, 'easy'],
    ]);
    // A worse run does not replace a better one; a better one at another level does.
    await store.setBest(hard.id, 7, 'easy');
    expect((await store.getUserById(hard.id))!.bestLevel).toBe('hard');
    await store.setBest(easy.id, 5, 'normal'); // 5 + 2 is not more than 7
    expect((await store.getUserById(easy.id))!.bestRound).toBe(7);
    await store.setBest(easy.id, 6, 'normal'); // 6 + 2 beats 7
    expect(await store.getUserById(easy.id)).toMatchObject({ bestRound: 6, bestLevel: 'normal' });
    store.close();
  });

  it('gives everyone the same made-up account number every time', () => {
    expect(accountNumber(7)).toBe(accountNumber(7));
    expect(accountNumber(7)).not.toBe(accountNumber(8));
    expect(accountNumber(7)).toMatch(/^LA \d{4} \d{4}$/);
  });
});

describe('the shop', () => {
  it('has something in every aisle, each with its own id and a price', () => {
    for (const c of SHOP_CATEGORIES) expect(SHOP_ITEMS.some((i) => i.category === c.id)).toBe(true);
    expect(new Set(SHOP_ITEMS.map((i) => i.id)).size).toBe(SHOP_ITEMS.length);
    for (const i of SHOP_ITEMS) expect(i.price).toBeGreaterThan(0);
    for (const i of SHOP_ITEMS.filter((x) => x.category === 'clothes')) expect(i.slot).toBeDefined();
    for (const i of SHOP_ITEMS.filter((x) => x.category === 'upgrades')) expect(i.level).toBeGreaterThan(1);
  });

  it('takes the money and hands over the goods, or neither', async () => {
    const store = new SqliteStore(':memory:');
    const u = (await store.createUser('Shopper', 'hash', '#fff'))!;
    await store.addCash(u.id, 400, 'Casino cash-out');
    expect(await store.buy(u.id, 'hat-fedora', 250, 'Shoddy.com: Lucky fedora')).toBe(true);
    // 150 left: the shades are fine, the chain is not.
    expect(await store.buy(u.id, 'chain', 800, 'Shoddy.com: Big gold chain')).toBe(false);
    expect(await store.buy(u.id, 'shades', 120, 'Shoddy.com: Poker shades')).toBe(true);
    expect(await store.ownedItems(u.id)).toEqual(['hat-fedora', 'shades']);
    expect((await store.getUserById(u.id))!.cash).toBe(30);
    const lines = await store.bankHistory(u.id, 10);
    expect(lines.map((l) => l.amount)).toEqual([-120, -250, 400]);
    expect(lines[0].balance).toBe(30);
    store.close();
  });

  it('moves you into a bigger flat as part of the purchase', async () => {
    const store = new SqliteStore(':memory:');
    const u = (await store.createUser('Mover', 'hash', '#fff'))!;
    await store.addCash(u.id, 6000, 'A good night');
    expect(await store.buy(u.id, 'apt-2', 5000, 'Shoddy.com: One-bedroom flat', 2)).toBe(true);
    const after = (await store.getUserById(u.id))!;
    expect(after.aptLevel).toBe(2);
    expect(after.cash).toBe(1000);
    store.close();
  });

  it('remembers what you have on', async () => {
    const store = new SqliteStore(':memory:');
    const u = (await store.createUser('Dresser', 'hash', '#fff'))!;
    await store.setOutfit(u.id, ['shades', 'scarf']);
    expect((await store.getUserById(u.id))!.outfit).toEqual(['shades', 'scarf']);
    store.close();
  });

  it('only lets you wear what you own, one thing per place', () => {
    expect(validOutfit(['shades', 'chain', 'scarf', 'hat-fedora', 'bed', 42], ['shades', 'chain', 'scarf', 'bed'])).toEqual(['shades', 'scarf']);
    expect(validOutfit('shades', ['shades'])).toEqual([]);
  });

  it('says why you cannot buy something', () => {
    const me = { cash: 300, owned: ['hat-fedora'], aptLevel: 2 };
    expect(cannotBuy(shopItem('hat-fedora'), me)).toMatch(/already/);
    expect(cannotBuy(shopItem('apt-2'), me)).toMatch(/already/);
    expect(cannotBuy(shopItem('apt-3'), me)).toMatch(/declined/);
    expect(cannotBuy(shopItem('sneakers'), me)).toBeNull();
    expect(cannotBuy(undefined, me)).toMatch(/not for sale/);
  });
});
