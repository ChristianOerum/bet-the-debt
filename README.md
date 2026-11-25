# Bet the Debt

A first-person casino game for the browser that you play with friends.

You get 500 chips from the house when you walk in. Every few hands it takes an ante, and the
ante keeps going up. Cash out before you go broke, or security walks you out the back.

<img src="docs/screenshots/blackjack.jpg" width="32%"> <img src="docs/screenshots/penthouse.jpg" width="32%"> <img src="docs/screenshots/restroom-mirror.jpg" width="32%">

## What's in it

- Blackjack, roulette, baccarat, Texas hold'em, liar's dice, Meyer and Russian roulette
- Private lobbies for up to 8 players
- Easy, normal and hard difficulty
- NPC regulars you can play against
- An apartment you can upgrade, with a computer for your bank account and a shop
- Drinking, gut feelings, guns, street dealers and a few other bad ideas

## Running it

Needs Node.js 22.5 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

To host it for friends:

```bash
npm run build
npm start
```

The game runs on port 3000. On the same network, friends can use your local IP. Over the
internet, a Cloudflare tunnel works fine:

```bash
cloudflared tunnel --url http://localhost:3000
```

Accounts are stored in `server/data/casino.db`.

## Controls

WASD to move, mouse to look, E to use things, click to punch/eat/drink/shoot, 1-4 for the
hotbar, P to pee, Enter to chat, Esc for the menu (which also lists the rest).

## Code

TypeScript all the way through. Three.js and Vite in the browser, Node, Express and
Socket.IO on the server, SQLite for saving. The server runs every game, so clients can't cheat.

- `shared/` rules and types used by both sides
- `server/` lobbies, game tables, NPCs, storage
- `client/` the 3D world, game tables and UI

```bash
npm test
```

## License

MIT
