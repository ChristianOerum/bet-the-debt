import { COLORS, GAME_NAME, type AuthResponse } from '@casino/shared';
import { api } from '../net';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const COLOR_KEY = 'cozychip.color';

/** The log in / sign up card. Calls `onAuth` once the server accepts the player. */
export function initLogin(onAuth: (auth: AuthResponse) => void) {
  const screen = $('#login');
  const form = $<HTMLFormElement>('#login-form');
  const name = $<HTMLInputElement>('#login-name');
  const pass = $<HTMLInputElement>('#login-pass');
  const error = $('#login-error');
  const submit = $<HTMLButtonElement>('#login-submit');
  const tabs = [...form.querySelectorAll<HTMLButtonElement>('.tabs button')];
  const swatches = $('#swatches');
  form.querySelector('.game-name')!.textContent = GAME_NAME;
  document.title = GAME_NAME;

  let mode: 'login' | 'register' = 'login';
  let color = localStorage.getItem(COLOR_KEY) ?? COLORS[Math.floor(Math.random() * COLORS.length)];
  if (!COLORS.includes(color)) color = COLORS[0];

  const setMode = (m: typeof mode) => {
    mode = m;
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
    submit.textContent = m === 'login' ? 'Log in' : 'Create account';
    pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    error.textContent = '';
  };
  tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode as typeof mode)));

  for (const c of COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.setAttribute('aria-label', `Colour ${c}`);
    b.classList.toggle('active', c === color);
    b.addEventListener('click', () => {
      color = c;
      localStorage.setItem(COLOR_KEY, c);
      [...swatches.children].forEach((el) => el.classList.toggle('active', el === b));
    });
    swatches.appendChild(b);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    try {
      const auth = await api<AuthResponse>(mode, { body: { username: name.value, password: pass.value, color } });
      pass.value = '';
      onAuth(auth);
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : 'Something went wrong.';
    } finally {
      submit.disabled = false;
    }
  });

  return {
    show(message = '') {
      screen.hidden = false;
      error.textContent = message;
      name.focus();
    },
    hide() {
      screen.hidden = true;
    },
  };
}
