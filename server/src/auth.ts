import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router, type Request, type Response } from 'express';
import { COLORS, type AuthResponse, type AuthUser } from '@casino/shared';
import type { Store, UserRecord } from './store/Store';

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 72; // bcrypt ignores anything longer

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Look up who a session token belongs to. Only a hash of the token is ever stored. */
export async function userFromToken(store: Store, token: unknown): Promise<UserRecord | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  return store.getSessionUser(hashToken(token));
}

const publicUser = (u: UserRecord): AuthUser => ({ id: u.id, name: u.username, color: u.color, cash: u.cash });

/** Allow `max` hits per `windowMs` for each key. */
class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  blocked(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, recent);
    return recent.length >= this.max;
  }

  hit(key: string) {
    const list = this.hits.get(key) ?? [];
    list.push(Date.now());
    this.hits.set(key, list);
    if (this.hits.size > 5000) this.hits.clear();
  }
}

export function createAuthRouter(store: Store): Router {
  const router = Router();
  const perIp = new RateLimiter(30, 60_000);
  const failedLogins = new RateLimiter(6, 5 * 60_000);
  // Compared against when the username does not exist, so both cases take the same time.
  const dummyHash = bcrypt.hashSync('not-a-real-password', 10);

  const bearer = (req: Request) => {
    const header = req.headers.authorization ?? '';
    return header.startsWith('Bearer ') ? header.slice(7) : null;
  };

  const startSession = async (user: UserRecord, res: Response) => {
    const token = crypto.randomBytes(32).toString('base64url');
    await store.createSession(hashToken(token), user.id);
    const body: AuthResponse = { token, user: publicUser(user) };
    res.json(body);
  };

  const readCredentials = (req: Request, res: Response) => {
    const ip = req.ip ?? 'unknown';
    if (perIp.blocked(ip)) {
      res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
      return null;
    }
    perIp.hit(ip);
    const { username, password, color } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Username and password are required.' });
      return null;
    }
    return {
      username: username.trim(),
      password,
      color: typeof color === 'string' && COLORS.includes(color) ? color : null,
    };
  };

  router.post('/register', async (req, res) => {
    const c = readCredentials(req, res);
    if (!c) return;
    if (!USERNAME_RE.test(c.username)) {
      res.status(400).json({ error: 'Username must be 3-16 letters, numbers or underscores.' });
      return;
    }
    if (c.password.length < PASSWORD_MIN || c.password.length > PASSWORD_MAX) {
      res.status(400).json({ error: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.` });
      return;
    }
    const hash = await bcrypt.hash(c.password, 10);
    const user = await store.createUser(c.username, hash, c.color ?? COLORS[0]);
    if (!user) {
      res.status(409).json({ error: 'That username is taken.' });
      return;
    }
    await startSession(user, res);
  });

  router.post('/login', async (req, res) => {
    const c = readCredentials(req, res);
    if (!c) return;
    const key = c.username.toLowerCase();
    if (failedLogins.blocked(key)) {
      res.status(429).json({ error: 'Too many wrong passwords. Try again in a few minutes.' });
      return;
    }
    const user = await store.getUserByName(c.username);
    const ok = await bcrypt.compare(c.password.slice(0, PASSWORD_MAX), user?.passwordHash ?? dummyHash);
    if (!user || !ok) {
      failedLogins.hit(key);
      res.status(401).json({ error: 'Wrong username or password.' });
      return;
    }
    if (c.color && c.color !== user.color) {
      await store.setColor(user.id, c.color);
      user.color = c.color;
    }
    await startSession(user, res);
  });

  router.get('/me', async (req, res) => {
    const user = await userFromToken(store, bearer(req));
    if (!user) {
      res.status(401).json({ error: 'Not logged in.' });
      return;
    }
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', async (req, res) => {
    const token = bearer(req);
    if (token) await store.deleteSession(hashToken(token));
    res.json({ ok: true });
  });

  return router;
}
