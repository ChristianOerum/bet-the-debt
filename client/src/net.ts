import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@casino/shared';

export type GameSocket = Socket<ServerToClient, ClientToServer>;

/** Open the live connection. The server checks the token before letting us in. */
export function connect(token: string): GameSocket {
  return io({ auth: { token } });
}

/** Call one of the account endpoints. Throws an Error with a message meant for the player. */
export async function api<T>(path: string, options: { body?: unknown; token?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method: options.body ? 'POST' : 'GET',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the casino. Is the server running?');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Try again.');
  return data as T;
}
