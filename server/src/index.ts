import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { createAuthRouter } from './auth';
import { Hub, type GameServer } from './hub';
import { SqliteStore } from './store/SqliteStore';

const here = path.dirname(fileURLToPath(import.meta.url));
// `--port 3000` on the command line wins (used in development, where the website has its
// own port); otherwise the PORT setting that cloud hosts provide; otherwise 3000.
const portArg = process.argv.indexOf('--port');
const PORT = Number((portArg > 0 && process.argv[portArg + 1]) || process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH ?? path.join(here, '../data/casino.db');

const store = new SqliteStore(DB_PATH);
const app = express();
// Behind a tunnel on this machine, the visitor's real address arrives in a header.
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '10kb' }));
app.use('/api', createAuthRouter(store));

// After `npm run build` the server also hands out the website itself.
const dist = path.join(here, '../../client/dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = http.createServer(app);
const io: GameServer = new Server(server);
new Hub(io, store);

server.listen(PORT, () => {
  console.log(`Casino server running on http://localhost:${PORT}`);
});
