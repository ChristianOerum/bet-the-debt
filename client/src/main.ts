import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/700-italic.css';
import './style.css';
import * as THREE from 'three';
import {
  aptDesk,
  aptDoor,
  aptFridge,
  atBar,
  anteFor,
  dealerAt,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  DRUGS,
  isDifficulty,
  type Difficulty,
  gamesInRoom,
  HOTBAR_SLOTS,
  heldInfo,
  menuItem,
  portions,
  stallHideFor,
  type Body,
  type Effects,
  toiletAt,
  type HeldItem,
  type Vitals,
  aptFrame,
  aptSize,
  aptToWorld,
  APT_SLOTS,
  CASHIER,
  CASINO_DOOR,
  cashFor,
  doorways,
  OPENINGS,
  portal,
  RUN,
  SECRET_DOOR,
  STATIONS,
  zoneAt,
  type AuthUser,
  type DeathEvent,
  type DoorAccess,
  type EscortEvent,
  type LobbyInfo,
  type PatronInfo,
  type PlayerInfo,
  type Pt,
  type RunState,
  type WelcomeMsg,
  type ZoneKey,
} from '@casino/shared';
import type { GameView } from './games/GameView';
import { VIEW_TYPES } from './games/registry';
import { api, connect, type GameSocket } from './net';
import { gunshot, silencedShot, thump } from './sfx';
import { BarMenu } from './ui/barMenu';
import { iconHtml } from './ui/icons';
import { Computer } from './ui/computer';
import { Hud } from './ui/hud';
import { initLogin } from './ui/login';
import { Avatars, type Pose } from './world/avatars';
import { Bodies, Dealers } from './world/bodies';
import { buildCharacter, disposeObject, dressCharacter, partsOf, REST_HANDS, updateArms } from './world/character';
import { mirrorHooks } from './world/mirror';
import { Doors } from './world/doors';
import { Escorts } from './world/escort';
import { FirstPersonArms, type ArmsMode } from './world/fpArms';
import { Npcs } from './world/npcs';
import { PeeStreams } from './world/pee';
import { PlayerController } from './world/player';
import { createWorld } from './world/scene';

const TOKEN_KEY = 'cozychip.token';
const DIFFICULTY_KEY = 'cozychip.difficulty';
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const GAME_LABEL: Record<string, string> = {
  blackjack: 'Blackjack',
  roulette: 'Roulette',
  baccarat: 'Baccarat',
  poker: "Texas Hold'em",
  liars: "Liar's Dice",
  meyer: 'Meyer',
  russian: 'Russian roulette',
};

async function boot() {
  // Signs and cards are painted with these fonts, so wait for them before building the world.
  const fonts = ['500 40px Fredoka', '600 40px Fredoka', '700 40px Fredoka', '700 40px "Playfair Display"', 'italic 700 40px "Playfair Display"'];
  await Promise.all(fonts.map((f) => document.fonts.load(f))).catch(() => {});

  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const world = createWorld(canvas);
  const player = new PlayerController(world.camera, canvas);
  const avatars = new Avatars(world.scene);
  const npcs = new Npcs(world.casino);
  const arms = new FirstPersonArms();
  world.camera.add(arms.group);
  const views = new Map<string, GameView>();
  const names = new Map<number, string>();
  const bodies = new Bodies(world.casino);
  const dealers = new Dealers(world.street);
  /** Drugs working on you, and until when. */
  let effects: Effects = {};
  const high = (id: keyof Effects) => (effects[id] ?? 0) > Date.now();

  let socket: GameSocket | null = null;
  let token: string | null = localStorage.getItem(TOKEN_KEY);
  let me: PlayerInfo | null = null;
  let chips = 0;
  let run: RunState | null = null;
  let ghost = false;
  let mySlot = 0;
  let lobby: LobbyInfo = { code: null, difficulty: 'hard', members: [] };
  /** The house's regulars, by id (all negative). */
  const patrons = new Map<number, PatronInfo>();
  let seatedAt: { view: GameView; seat: number } | null = null;
  let aimedAt: { view: GameView; seat: number } | null = null;
  /** From security grabbing you until you are a ghost. */
  let dying = false;

  const hud = new Hud({
    chat: (text) => socket?.emit('chat', text),
    chatClosed: () => player.lockMouse(),
    resume: () => player.lockMouse(),
    leaveTable: () => socket?.emit('leave'),
    leaveLobby: () => socket?.emit('lobbyLeave'),
    logout: () => {
      if (token) api('logout', { body: {}, token }).catch(() => {});
      leaveGame();
    },
    menuChanged: (open) => player.pause(open),
  });

  // The computer on the desk at home: the bank and the shop.
  let cash = 0;
  let owned: string[] = [];
  let outfit: string[] = [];

  // ---- you, in the mirror ----------------------------------------------------------------
  // In first person you have no body, only arms. Mirrors draw this one instead: your character,
  // in your colour and clothes, where you stand. Nothing else ever draws it.
  let selfModel: THREE.Group | null = null;
  function buildSelf() {
    if (selfModel) {
      world.scene.remove(selfModel);
      disposeObject(selfModel);
      selfModel = null;
    }
    if (!me) return;
    selfModel = buildCharacter(me.color);
    selfModel.visible = false;
    dressCharacter(selfModel, outfit);
    world.scene.add(selfModel);
  }
  const showSelf = () => player.active && !ghost && !player.dead && !player.isWaking && !player.seated;
  let armsWere = true;
  mirrorHooks.before = () => {
    armsWere = arms.group.visible;
    arms.group.visible = false; // no floating arms in the glass
    if (selfModel) selfModel.visible = showSelf();
  };
  mirrorHooks.after = () => {
    arms.group.visible = armsWere;
    if (selfModel) selfModel.visible = false;
  };
  /** Put your mirror body where you are, walking (arms swinging) or peeing like everyone else. */
  function updateSelf() {
    if (!selfModel) return;
    const g = selfModel;
    const swing = player.moving && !player.airborne ? Math.sin(player.stride) : 0;
    g.position.set(player.pos.x, player.pos.y + Math.abs(swing) * 0.05, player.pos.z);
    g.rotation.y = player.yaw + Math.PI;
    const parts = partsOf(g);
    for (let i = 0; i < 2; i++) {
      const hnd = parts.hands[i].position;
      hnd.copy(REST_HANDS[i]);
      hnd.z += (i === 0 ? swing : -swing) * 0.16;
      if (peeing) hnd.set(i === 0 ? -0.07 : 0.07, 0.5, 0.3);
    }
    updateArms(parts);
  }
  /** Your own arms are the colour of your sleeves. */
  const sleeves = () => (outfit.includes('suit-gold') ? '#e7b93c' : (me?.color ?? '#ffffff'));
  const computer = new Computer({
    loadBank: () =>
      new Promise((resolve, reject) => {
        if (!socket?.connected) return reject(new Error('offline'));
        socket.emit('bank', resolve);
      }),
    buy: (itemId) =>
      new Promise((resolve, reject) => {
        if (!socket?.connected) return reject(new Error('offline'));
        socket.emit('shopBuy', itemId, (r) => {
          owned = r.owned;
          resolve(r);
        });
      }),
    wear: (items) => {
      outfit = [...items];
      arms.setColor(sleeves());
      if (selfModel) dressCharacter(selfModel, outfit);
      socket?.emit('wear', outfit);
    },
    changed: (open) => {
      player.pause(open);
      if (!open) player.lockMouse();
    },
  });
  hud.addOverlay(computer);

  // Your body, and the bar that looks after it (badly).
  let vitals: Vitals = { health: 100, hunger: 75, thirst: 75, bladder: 15, bac: 0 };
  /** Blood alcohol as felt: eases towards the real number, so the world does not lurch. */
  let felt = 0;
  let peeing = false;

  // ---- what is in your hands: the hotbar (keys 1-4), click to eat, drink or punch ----
  let items: (HeldItem | null)[] = Array<HeldItem | null>(HOTBAR_SLOTS).fill(null);
  /** The slot you are holding, or null for bare fists. */
  let selected: number | null = null;
  /** Seconds of screen shake left after taking a punch. */
  let shake = 0;
  function refreshHand() {
    hud.setHotbar(items, selected);
    const held = selected !== null ? items[selected] : null;
    const item = held ? menuItem(held.itemId) : undefined;
    arms.hold(held && heldInfo(held.itemId) ? held.itemId : null, held && item ? held.left / portions(item) : 1);
  }
  /** Order something (bar or fridge); it lands in your hand. */
  const order = (itemId: string) =>
    new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
      if (!socket?.connected) return reject(new Error('offline'));
      socket.emit('order', itemId, (r) => {
        const slot = (r as { slot?: number }).slot;
        if (r.ok && slot !== undefined && (selected === null || !items[selected])) {
          selected = slot; // straight into your hand, if it was empty
          refreshHand();
        }
        resolve(r);
      });
    });
  /** Bang. The server decides what it hits; the flash and the kick are ours straight away. */
  let lastShot = 0;
  function shoot(slot: number) {
    const now = performance.now();
    if (now - lastShot < 400) return;
    lastShot = now;
    if (world.zone !== 'casino' || !run) {
      hud.toast('Not here. Save it for the casino.', 'bad');
      return;
    }
    arms.fire();
    shake = Math.max(shake, 0.08);
    if (items[slot]?.itemId === 'pistol-silenced') silencedShot(1);
    else gunshot(1);
    socket?.emit('shoot', slot, player.yaw, player.pitch);
  }

  /** A bite or a sip of what is in that slot. */
  function useSlot(slot: number) {
    if (!items[slot] || ghost || player.dead) return;
    arms.eat();
    socket?.emit('use', slot);
  }

  const bar = new BarMenu({
    order,
    chips: () => chips,
    changed: (open) => {
      player.pause(open);
      if (!open) player.lockMouse();
    },
    say: (text, ok) => hud.toast(text, ok ? 'info' : 'bad'),
  });
  hud.addOverlay(bar);
  const streams = new PeeStreams(world.scene);

  // Pressing Esc while looking around makes the browser let go of the mouse (and it
  // keeps that key press to itself), so treat losing the mouse that way as "open the menu".
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement || !player.active) return;
    if (player.seated || player.scripted || player.dead || hud.menuOpen || hud.dialogOpen || hud.overlayOpen) return;
    if (document.activeElement?.tagName === 'INPUT') return;
    hud.openMenu(false);
  });
  const login = initLogin((auth) => enterGame(auth.token));

  // ---- where you are ----------------------------------------------------------------

  const levelOf = (slot: number) => lobby.members.find((m) => m.slot === slot)?.aptLevel ?? 1;
  const doors = new Doors(world.scene);

  /** Which doors open for you: the same rule as the server's. */
  function access(): DoorAccess {
    return { casino: !!lobby.code && !run && !ghost, apts: lobby.members.map((m) => ({ slot: m.slot, level: m.aptLevel })) };
  }
  const opensFor = (id: string) => {
    if (id === 'building' || id === 'restroom') return true;
    if (id === 'casino') return access().casino;
    return lobby.members.some((m) => `apt:${m.slot}` === id);
  };
  /** Call whenever the lobby, your run or your ghostliness changes. */
  const refreshAccess = () => player.setAccess(access());

  let myZone: ZoneKey = 'casino';
  /**
   * Show the zone you are in and any you can see into through a doorway nearby. `snap`
   * jumps the air straight to the new zone (after a teleport) instead of easing it over.
   */
  function setZone(zone: ZoneKey, snap = false) {
    myZone = zone;
    const seen = new Set<ZoneKey>([zone]);
    const at = player.pos;
    for (const d of doorways(levelOf)) {
      if (!d.zones.includes(zone)) continue;
      if (d.slot !== undefined && !lobby.members.some((m) => m.slot === d.slot)) continue; // a locked door
      // The casino is a lot to draw: only peek in from right by its doors.
      if (Math.hypot(at.x - d.at.x, at.z - d.at.z) < (d.id === 'casino' ? 9 : 12)) for (const z of d.zones) seen.add(z);
    }
    world.setZone(zone, seen, snap);
    avatars.viewZone = zone;
    avatars.viewZones = seen;
  }

  /** Wake up in your own bed. */
  function wakeInBed() {
    const level = levelOf(mySlot);
    const { w } = aptSize(level);
    const lying = aptToWorld(mySlot, level, w - 0.45, 1.05);
    const stand = aptToWorld(mySlot, level, w - 1.55, 2.6);
    // On a real bed (bought, or the penthouse's), your head is higher than on a mattress on the floor.
    const raised = level >= 3 || !!lobby.members.find((m) => m.slot === mySlot)?.home.includes('bed');
    player.wakeUp(new THREE.Vector3(lying.x, raised ? 0.8 : 0.5, lying.z),{ ...stand, yaw: Math.PI / 2 + 0.35 + aptFrame(mySlot, level).rot });
    setZone(`apt:${mySlot}`, true);
    hud.eyesOpen();
  }

  // ---- being shown out ---------------------------------------------------------------

  const isMe = (ev: { id: number }) => ev.id === me?.id;
  const escorts = new Escorts(world.casino, world.exitDoors, {
    // A slow tab can still be playing the walk after the server has made you a ghost:
    // from then on the cinematic no longer moves you.
    victim(ev, pose) {
      if (isMe(ev)) {
        if (!ghost) player.setScript({ ...pose, pitch: -0.05 });
      } else avatars.setScript(ev.id, pose);
    },
    shot(ev, first, from) {
      const mine = isMe(ev);
      if (mine && ghost) return;
      const far = Math.hypot(from.x - world.camera.position.x, from.z - world.camera.position.z);
      if (mine || world.zone === 'casino') gunshot(mine ? 1 : Math.max(0.12, 0.75 - far / 40));
      if (!first) return;
      const murder = ev.cause === 'murder';
      hud.addSystem(
        murder ? `${ev.name} was seen killing someone, and was shown out back.` : ev.npc ? `${ev.name} lost the lot, and was shown out back.` : `${ev.name} couldn't pay, and was shown out back in round ${ev.round}.`,
        'obit',
      );
      if (mine) {
        hud.flash();
        player.die();
        hud.showDeath(murder ? 'Security saw what you did. Nobody kills on their floor.' : ev.byAnte ? `You couldn't cover the ante in round ${ev.round}.` : `You went broke in round ${ev.round}.`);
      } else {
        avatars.kill(ev.id);
      }
    },
    // The server turns them into a ghost at this moment; nothing to do here.
    respawn: () => {},
  });

  /** Shot dead right at the table (Russian roulette), or drank or starved to death. */
  function onDied(ev: DeathEvent) {
    const mine = isMe(ev);
    if (ev.cause === 'shot') {
      // The bang itself came with the shot.
      hud.addSystem(ev.by ? `${ev.name} was shot dead by ${ev.by}.` : `${ev.name} was shot dead.`, 'obit');
      if (!mine) {
        avatars.kill(ev.id);
        return;
      }
      dying = true;
      hud.flash();
      player.die();
      hud.showDeath(ev.by ? `${ev.by} shot you. Everything you had on you is lying there with you.` : 'Somebody shot you.');
      return;
    }
    if (ev.cause === 'alcohol' || ev.cause === 'collapse' || ev.cause === 'beaten') {
      const how = ev.cause === 'alcohol' ? 'drank themselves to death' : ev.cause === 'beaten' ? 'was punched out cold' : 'keeled over from hunger and thirst';
      hud.addSystem(`${ev.name} ${how}.`, 'obit');
      if (!mine) {
        avatars.kill(ev.id);
        return;
      }
      // No bang: the room swims, the lids get heavy, and it all goes dark.
      dying = true;
      hud.eyesClose();
      setTimeout(() => {
        player.die();
        if (dying) {
          hud.showDeath(
            ev.cause === 'alcohol'
              ? `${vitals.bac.toFixed(2)} ‰. One more was one too many.`
              : ev.cause === 'beaten'
                ? 'Somebody punched you one time too many.'
                : 'You forgot to eat. And drink. For quite a while.',
          );
        }
      }, 3600);
      return;
    }
    const far = Math.hypot(ev.at.x - world.camera.position.x, ev.at.z - world.camera.position.z);
    if (mine || world.zone === 'casino') gunshot(mine ? 1 : Math.max(0.15, 0.85 - far / 30));
    hud.addSystem(ev.npc ? `${ev.name} found the bullet.` : `${ev.name} found the bullet in round ${ev.round}.`, 'obit');
    if (mine) {
      dying = true;
      hud.flash();
      player.die();
      hud.showDeath('You found the bullet. The others split your chips.');
    } else {
      avatars.kill(ev.id);
    }
  }

  function becomeGhost(on: boolean) {
    ghost = on;
    dying = false;
    refreshAccess();
    hud.setGhost(on);
    hud.hideDeath();
    hud.setEscorted(false);
    if (on) hud.eyesReset(); // a ghost sees again, if only in grey
    if (on) hud.toast('You are dead. Watch your friends; you will wake up at home when they are done.', 'bad');
  }

  // ---- the bookcase that hides the back room --------------------------------------------

  const secretPortal = portal(OPENINGS.find((o) => o.kind === 'secret')!);
  const secret = { open: 0, until: 0 };
  const inPassage = (p: Pt, pad: number) =>
    p.x > secretPortal.x0 - pad && p.x < secretPortal.x1 + pad && p.z > secretPortal.z0 - pad && p.z < secretPortal.z1 + pad;
  const inSecretPassage = () => inPassage(player.pos, 0.4);
  function updateSecret(dt: number, now: number) {
    // The regulars know the trick with the red book too.
    const patronPassing = world.zone === 'casino' && avatars.positions().some((p) => inPassage(p, 1.6));
    const wanted = now < secret.until || inSecretPassage() || escorts.needsSecretDoor || patronPassing;
    secret.open += ((wanted ? 1 : 0) - secret.open) * (1 - Math.exp(-dt * 4));
    world.secretDoor.rotation.y = secret.open * 1.4;
    player.setSecretOpen(secret.open > 0.6 || inSecretPassage());
  }

  // ---- joining and leaving -------------------------------------------------

  function clearRoom() {
    avatars.clear();
    bodies.clear();
    hud.setPeek(null);
    names.clear();
    for (const v of views.values()) v.dispose();
    views.clear();
    escorts.reset();
    seatedAt = null;
    aimedAt = null;
    dying = false;
    becomeGhost(false);
    hud.hideDeath();
    hud.setEscorted(false);
    hud.setSeated(false);
    hud.setPrompt(null);
  }

  function leaveGame(message = '') {
    socket?.disconnect();
    socket = null;
    token = null;
    me = null;
    localStorage.removeItem(TOKEN_KEY);
    player.active = false;
    if (document.pointerLockElement) document.exitPointerLock();
    clearRoom();
    computer.close();
    bar.close();
    streams.clear();
    peeing = false;
    vitals = { ...vitals, bac: 0 };
    felt = 0;
    hud.eyesReset();
    setZone('casino', true);
    hud.show(false);
    login.show(message);
  }

  function enterGame(newToken: string) {
    token = newToken;
    localStorage.setItem(TOKEN_KEY, newToken);
    login.hide();
    socket?.disconnect();
    const s = connect(newToken);
    socket = s;

    s.on('connect_error', (err) => {
      if (err.message === 'unauthorized') leaveGame('Please log in again.');
    });
    s.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect' && me) hud.addSystem('Connection lost. Reconnecting…');
    });
    s.on('welcome', onWelcome);
    s.on('kicked', (reason) => leaveGame(reason));
    s.on('notice', (text, kind) => hud.toast(text, kind));
    s.on('chat', (msg) => {
      hud.addChat(msg);
      if (msg.id !== me?.id) avatars.say(msg.id, msg.text);
    });
    s.on('vitals', (v) => {
      vitals = v;
      hud.setVitals(v);
    });
    s.on('peeing', (id, on, atToilet) => {
      if (id === me?.id) peeing = on;
      else avatars.setPeeing(id, on);
      if (on) streams.start(id, atToilet);
      else streams.stop(id);
    });
    s.on('gutChance', (chance) => hud.setGutChance(chance));
    s.on('gut', (text, pick) => {
      hud.toast(text, 'gut');
      gutPick = { sel: pick, seen: false };
      markGut();
    });
    s.on('items', (list) => {
      items = list;
      refreshHand();
    });
    s.on('ate', (id, itemId) => {
      if (id !== me?.id) avatars.eat(id, itemId);
    });
    s.on('punched', (id, target) => {
      if (id !== me?.id) avatars.punch(id);
      if (target === null) return;
      if (target === me?.id) {
        shake = 0.35; // ow
        hud.flash();
      } else avatars.flinch(target);
      thump(id === me?.id || target === me?.id ? 1 : 0.4);
    });
    s.on('shot', (id, silenced, _yaw, _pitch, hit) => {
      if (id !== me?.id) {
        avatars.shoot(id, silenced ? 'pistol-silenced' : 'pistol');
        const at = avatars.positionOf(id);
        const far = at ? Math.hypot(at.x - player.pos.x, at.z - player.pos.z) : 30;
        if (silenced) {
          if (far < 9) silencedShot(Math.max(0.1, 1 - far / 9));
        } else if (world.zone === 'casino' || far < 25) gunshot(Math.max(0.15, 0.9 - far / 40));
      }
      if (hit === null) return;
      if (hit === me?.id) {
        shake = 0.5;
        hud.flash();
      } else avatars.flinch(hit);
    });
    s.on('bodies', (list: Body[]) => bodies.set(list));
    s.on('effects', (e) => {
      effects = e;
      hud.setEffects(e);
    });
    s.on('peek', (text) => hud.setPeek(text));
    s.on('dressed', (id, items) => {
      if (id === me?.id) return; // you already know what you have on
      avatars.dress(id, items);
    });
    s.on('patronJoined', (p) => {
      patrons.set(p.id, p);
      avatars.add(p, true);
    });
    s.on('patronLeft', (id) => {
      patrons.delete(id);
      avatars.remove(id);
    });
    s.on('leaderboard', (list) => world.setLeaderboard(list));
    s.on('run', (r) => {
      run = r;
      hud.setRun(r);
      refreshAccess(); // the doors shut behind you on a run, and open again once you cash out
    });
    s.on('cash', (c) => {
      cash = c;
      hud.setCash(c);
      computer.setCash(c);
    });
    s.on('lobby', (info) => {
      lobby = info;
      world.setLobby(info);
      hud.setLobby(info);
      refreshAccess(); // friends' front doors open for you
    });
    s.on('tableSecret', (stationId, secretState) => views.get(stationId)?.setSecret?.(secretState));
    s.on('died', onDied);
    s.on('ghost', () => becomeGhost(true));
    s.on('wake', () => {
      if (me) escorts.forget(me.id);
      becomeGhost(false);
      hud.fade(() => wakeInBed());
      hud.toast('You wake up at home. Whatever happened last night, there is nothing in your pockets.', 'info');
    });
    s.on('escort', (ev: EscortEvent) => {
      if (isMe(ev)) {
        dying = true;
        hud.setEscorted(true);
        hud.toast(ev.cause === 'murder' ? 'Security saw that. They are coming for you.' : 'Security will see you out.', 'bad');
      }
      escorts.start(ev);
    });
    s.on('teleported', (id, zone, x, z, yaw) => {
      if (id === me?.id) {
        // Moved by the house (died, woke up, shown out of a flat): black out, move, come back.
        if (zone === 'void') return;
        hud.fade(() => {
          player.stand(x, z, yaw);
          setZone(zone, true);
          seatedAt = null;
          hud.setSeated(false);
        });
        return;
      }
      avatars.teleport(id, zone, { x, z, yaw });
    });
    s.on('chips', (n) => {
      chips = n;
      hud.setChips(chips);
      for (const v of views.values()) v.refresh();
    });
    s.on('playerJoined', (p) => {
      if (p.id === me?.id) return;
      avatars.add(p);
      names.set(p.id, p.name);
      hud.addSystem(`${p.name} joined`);
      hud.setOnline(avatars.count + 1);
    });
    s.on('playerLeft', (id) => {
      const name = names.get(id);
      if (!name) return;
      avatars.remove(id);
      names.delete(id);
      hud.addSystem(`${name} left`);
      hud.setOnline(avatars.count + 1);
    });
    s.on('moved', (id, x, z, yaw, y) => avatars.move(id, x, z, yaw, y));
    s.on('tableState', (stationId, state) => {
      views.get(stationId)?.setState(state);
      syncSeating();
    });
  }

  /** A whole new world: on login, and whenever you join or leave a lobby. */
  function onWelcome(w: WelcomeMsg) {
    clearRoom();
    me = w.you;
    mySlot = w.slot;
    chips = w.chips;
    run = w.run;
    lobby = w.lobby;
    world.setLobby(w.lobby);
    hud.setLobby(w.lobby);
    hud.setName(me.name, me.color);
    hud.setCash(w.cash);
    cash = w.cash;
    owned = [...w.owned];
    outfit = [...me.outfit];
    vitals = w.vitals;
    felt = w.vitals.bac;
    items = w.items;
    selected = null;
    refreshHand();
    bodies.set(w.bodies);
    effects = w.effects;
    hud.setEffects(effects);
    hud.setPeek(null);
    hud.setGutChance(0);
    hud.setVitals(w.vitals);
    peeing = false;
    streams.clear();
    hud.setChips(chips);
    hud.setRun(w.run);
    arms.setColor(sleeves());
    buildSelf();
    for (const p of w.players) {
      avatars.add(p);
      names.set(p.id, p.name);
    }
    patrons.clear();
    for (const p of w.patrons) {
      patrons.set(p.id, p);
      avatars.add(p, true);
    }
    for (const station of STATIONS) {
      if (!w.tables[station.id]) continue; // the casino only has tables for a lobby
      const make = VIEW_TYPES[station.type];
      if (!make) continue;
      const view = make(station, {
        myId: me.id,
        getChips: () => chips,
        send: (action) => socket?.emit('action', station.id, action),
        leave: () => socket?.emit('leave'),
        hudRoot: hud.gameRoot,
      });
      world.casino.add(view.group);
      views.set(station.id, view);
      view.setState(w.tables[station.id]);
    }
    world.setLeaderboard(w.leaderboard);
    player.active = true;
    becomeGhost(w.ghost); // also sets which doors open for you
    if (w.wakeUp) wakeInBed();
    else {
      // Joining or leaving a lobby at the casino doors: you stay right where you were.
      const moved = Math.hypot(player.pos.x - me.x, player.pos.z - me.z) > 0.6;
      if (moved || player.scripted || player.dead) player.stand(me.x, me.z, me.yaw);
      setZone(me.zone === 'void' ? 'casino' : me.zone, true);
    }
    hud.setOnline(avatars.count + 1);
    hud.show(true);
    syncSeating();
  }

  // ---- a hunch lights up the winning button --------------------------------------

  /** The button a gut feeling picked, until that decision is over (its button goes away). */
  let gutPick: { sel: string; seen: boolean } | null = null;
  function markGut() {
    const root = hud.gameRoot;
    for (const b of root.querySelectorAll('.gut-pick')) b.classList.remove('gut-pick');
    if (!gutPick) return;
    let found: NodeListOf<Element>;
    try {
      found = root.querySelectorAll(gutPick.sel);
    } catch {
      gutPick = null; // not a selector we understand
      return;
    }
    if (found.length) {
      gutPick.seen = true;
      for (const b of found) b.classList.add('gut-pick');
    } else if (gutPick.seen) gutPick = null; // decided (or the moment passed)
  }
  // The table redraws its buttons whenever anything changes: put the border back each time.
  new MutationObserver(markGut).observe(hud.gameRoot, { childList: true, subtree: true });

  // ---- sitting down and standing up ------------------------------------------

  function syncSeating() {
    let now: typeof seatedAt = null;
    const poses = new Map<number, Pose>();
    for (const view of views.values()) {
      const seat = view.mySeat();
      if (seat >= 0) now = { view, seat };
      for (const [id, pose] of view.seatedPlayers()) poses.set(id, pose);
    }
    avatars.setSeated(poses);

    if (now && !seatedAt && !dying) {
      player.sit(now.view.cameraPose(now.seat));
      aimedAt?.view.highlightSeat(null);
      aimedAt = null;
    } else if (!now && seatedAt && !dying && world.zone === 'casino') {
      const spot = seatedAt.view.seats()[seatedAt.seat];
      player.stand(spot.x + Math.sin(spot.yaw) * 0.9, spot.z + Math.cos(spot.yaw) * 0.9, spot.yaw);
    }
    if (!now) gutPick = null;
    seatedAt = now;
    hud.setSeated(now !== null);
  }

  // ---- things you can press E on ----------------------------------------------------

  interface Use {
    prompt: string;
    act: () => void;
    /** false: just a note, nothing to press E for. */
    key?: boolean;
  }
  /** Within reach of p, and roughly facing it (so the door behind you is not the one you use). */
  const close = (p: Pt, r: number) => {
    const dx = p.x - player.pos.x;
    const dz = p.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d >= r) return false;
    if (d < 0.45) return true;
    return (-Math.sin(player.yaw) * dx - Math.cos(player.yaw) * dz) / d > 0.2;
  };

  /** The doorman: start a lobby, join one, or (if you have one) go in. */
  /** The difficulty a new lobby starts at: remembered from last time. */
  let difficulty: Difficulty = isDifficulty(localStorage.getItem(DIFFICULTY_KEY)) ? (localStorage.getItem(DIFFICULTY_KEY) as Difficulty) : 'normal';
  function doormanDialog() {
    const level = (d: Difficulty) => {
      const r = DIFFICULTIES[d];
      return `<b>${r.label}</b>: ${r.blurb} <span class="quiet">Antes ${[1, 2, 3, 4].map((n) => anteFor(n, d)).join(', ')}…</span>`;
    };
    hud.openDialog(
      'The doorman',
      `<p>"Members only. Bring your own crowd."</p><p>Start a lobby and give your friends the code, or type theirs to join them.</p><input id="lobby-code" maxlength="4" placeholder="CODE" autocomplete="off" />
       <div class="difficulty">
         <label for="lobby-diff">How hard should the house squeeze a new lobby?</label>
         <input id="lobby-diff" type="range" min="0" max="2" step="1" value="${DIFFICULTY_ORDER.indexOf(difficulty)}" />
         <div class="diff-ticks">${DIFFICULTY_ORDER.map((d) => `<span>${DIFFICULTIES[d].label}</span>`).join('')}</div>
         <p id="diff-blurb">${level(difficulty)}</p>
       </div>`,
      [
        { label: 'Join with code', act: 'join', primary: true },
        { label: 'Start a new lobby', act: 'create' },
      ],
      (act) => {
        if (act === 'create') socket?.emit('lobbyCreate', difficulty);
        if (act === 'join') socket?.emit('lobbyJoin', hud.dialogInput());
      },
    );
    // read the code before the dialog closes
    const input = document.querySelector<HTMLInputElement>('#lobby-code');
    input?.addEventListener('input', () => (input.value = input.value.toUpperCase()));
    const slider = document.querySelector<HTMLInputElement>('#lobby-diff');
    slider?.addEventListener('input', () => {
      difficulty = DIFFICULTY_ORDER[Number(slider.value)] ?? 'normal';
      localStorage.setItem(DIFFICULTY_KEY, difficulty);
      document.querySelector('#diff-blurb')!.innerHTML = level(difficulty);
    });
  }

  function cashierDialog() {
    const take = cashFor(chips);
    hud.openDialog(
      'The cashier',
      `<p>You hand over <b>${chips.toLocaleString('en-US')}</b> chips. The house takes back the <b>${RUN.startChips}</b> it fronted you.</p><div class="big-num">$${take.toLocaleString('en-US')}</div><p>${take > 0 ? 'Yours to keep, for good.' : 'You would walk out with nothing. Maybe one more hand?'}</p>`,
      [{ label: 'Cash out and leave', act: 'cash', primary: take > 0, danger: take === 0 }],
      (act) => {
        if (act === 'cash') socket?.emit('cashOut');
      },
    );
  }

  /** Walk up to a regular on the floor: ask them to a game they like (or somewhere quieter). */
  function inviteDialog(p: PatronInfo) {
    socket?.emit('patronHail', p.id); // so they stop and listen
    // Only games with a table here in this room: for the others, find them where they are played.
    const here = gamesInRoom(player.pos);
    const games = p.likes.filter((g) => here.includes(g));
    const elsewhere = p.likes.filter((g) => !here.includes(g)).map((g) => GAME_LABEL[g] ?? g);
    const note = games.length
      ? 'Fancy a game? They might say yes.'
      : 'Nothing they play has a table in this room.';
    const also = elsewhere.length ? `<p class="quiet">They also play ${elsewhere.join(', ')}: ask them in the room where it's played.</p>` : '';
    hud.openDialog(
      p.name,
      `<p><i>${escapeHtml(p.blurb)}</i></p><p>${note}</p>${also}`,
      [
        ...games.map((g, k) => ({ label: g === 'russian' ? 'Russian roulette, right here' : `A game of ${GAME_LABEL[g] ?? g}`, act: g, primary: k === 0, danger: g === 'russian' })),
        { label: '🚻 "Step into the bathroom with me a minute?"', act: 'lure' },
      ],
      (act) => {
        if (act === 'lure') socket?.emit('patronLure', p.id);
        else if (act !== 'cancel') socket?.emit('patronInvite', p.id, act);
      },
    );
  }

  /** A dealer on the street: what they have, for cash. */
  function dealerDialog(name: string) {
    hud.openDialog(
      name,
      `<p><i>"Psst. You look like you need an edge."</i></p>${DRUGS.map((d) => `<p class="dlg-item">${iconHtml(d.id, d.icon, 'dlg-ico')}<span><b>${d.name}</b>, $${d.price}: ${escapeHtml(d.what)}</span></p>`).join('')}<p class="quiet">Cash only. You have $${cash.toLocaleString('en-US')}.</p>`,
      DRUGS.map((d, k) => ({ label: `${iconHtml(d.id, d.icon, 'btn-ico')} ${d.name} · $${d.price}`, act: d.id, primary: k === 0 })),
      (act) => {
        if (!DRUGS.some((d) => d.id === act)) return;
        socket?.emit('buyDrug', act, (r) => {
          cash = r.cash;
          hud.setCash(r.cash);
          hud.toast(r.ok ? `"Pleasure doing business." It's in your pocket. Click with it in hand to take it.` : (r.error ?? 'No deal.'), r.ok ? 'info' : 'bad');
        });
      },
    );
  }

  /** A regular in a chair you want. */
  function evictDialog(p: PatronInfo) {
    hud.openDialog(
      p.name,
      `<p><i>${escapeHtml(p.blurb)}</i></p><p>They look settled in. You could ask them nicely to give up the seat, or make it clear that they should.</p>`,
      [
        { label: 'Ask them to leave', act: 'ask', primary: true },
        { label: 'Threaten them', act: 'threaten', danger: true },
        { label: '🚻 "Step into the bathroom with me a minute?"', act: 'lure' },
      ],
      (act) => {
        if (act === 'ask' || act === 'threaten') socket?.emit('patronEvict', p.id, act);
        if (act === 'lure') socket?.emit('patronLure', p.id);
      },
    );
  }

  /** Step up to the bowl, look down, and go. */
  function useToilet(stand: { x: number; z: number; yaw: number }) {
    player.stand(stand.x, stand.z, stand.yaw);
    player.lookDown(0.5);
    socket?.emit('move', stand.x, stand.z, stand.yaw, 0); // the server checks you are at the toilet
    socket?.emit('pee', true);
  }

  /** At home, the fridge: free, and you get what you pay for. */
  function fridgeDialog() {
    hud.openDialog(
      'The fridge',
      '<p>A bottle of ketchup, something that used to be milk, and a light that flickers.</p>',
      [
        { label: `${iconHtml('tap-water', '🚰', 'btn-ico')} Glass of tap water`, act: 'tap-water', primary: true },
        { label: `${iconHtml('old-pizza', '🍕', 'btn-ico')} Leftover pizza`, act: 'old-pizza' },
      ],
      (act) => {
        if (act === 'tap-water' || act === 'old-pizza') void order(act).then((r) => (r.ok ? hud.toast('In your hand. Click to eat or drink it.', 'info') : hud.toast(r.error ?? 'No.', 'bad')));
      },
    );
  }

  /** 1-4: hold that slot (again to put it away). At a table, the mouse is busy with buttons, so it eats or drinks at once. */
  window.addEventListener('keydown', (e) => {
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n < 0 || e.repeat || hud.menuOpen || hud.dialogOpen || hud.overlayOpen || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (!me || ghost) return;
    if (player.seated) {
      useSlot(n);
      return;
    }
    selected = selected === n ? null : n;
    refreshHand();
  });

  /** Click (with the mouse captured): eat or drink what you hold, or throw a punch. */
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !player.mouseLocked || !me || ghost || player.seated || player.dead || player.scripted || player.isWaking) return;
    if (hud.menuOpen || hud.dialogOpen || hud.overlayOpen) return;
    if (selected !== null && items[selected] && arms.aiming) {
      shoot(selected);
      return;
    }
    if (selected !== null && items[selected]) {
      useSlot(selected);
      return;
    }
    arms.punch();
    socket?.emit('punch', player.yaw);
  });

  /** P: start, or stop. */
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyP' || e.repeat || hud.menuOpen || hud.dialogOpen || hud.overlayOpen || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (!me || ghost || player.dead || player.scripted) return;
    if (!peeing) player.lookDown(0.45); // so you can see where it is going
    socket?.emit('pee', !peeing);
  });

  /** A body you are standing over that could be hidden in the stall (H). */
  let bodyAt: Body | null = null;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyH' || e.repeat || !bodyAt || hud.menuOpen || hud.dialogOpen || hud.overlayOpen || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    socket?.emit('hideBody', bodyAt.id);
  });

  /** What is in reach right now, if anything. */
  function usable(): Use | null {
    bodyAt = null;
    if (!me || player.seated || player.dead || player.scripted || player.isWaking) return null;
    const zone = world.zone;
    // Doors just open as you walk up to them. These are only the ones that will not.
    const note = (prompt: string): Use => ({ prompt, act: () => {}, key: false });
    // Standing over a body (on the floor, or sat on the toilet): its pockets come first.
    if (zone === 'casino' && !ghost && run && !dying) {
      const b = bodies.near(player.pos, player.yaw);
      if (b) {
        const canHide = !b.hidden && stallHideFor(b) !== null;
        bodyAt = canHide ? b : null;
        return { prompt: `Go through ${b.name}'s pockets${canHide ? ' · H: hide them in a stall' : ''}`, act: () => socket?.emit('loot', b.id) };
      }
    }
    const loo = !ghost && !peeing ? toiletAt(player.pos, levelOf) : null;
    if (loo && loo.zone === zone) return { prompt: 'Use the toilet', act: () => useToilet(loo.stand) };
    if (zone === 'street') {
      if (close(CASINO_DOOR, 3)) return lobby.code ? null : { prompt: 'Talk to the doorman', act: doormanDialog };
      const dealer = dealerAt(player.pos);
      if (dealer && close(dealer.at, 2.4)) {
        return ghost || run ? note(`${dealer.name} looks straight through you.`) : { prompt: `Talk to ${dealer.name}`, act: () => dealerDialog(dealer.name) };
      }
    } else if (zone.startsWith('apt:')) {
      // Anyone's computer will do: you log in to your own account.
      const s = Number(zone.slice(4));
      if (close(aptDesk(s, levelOf(s)), 1.9)) {
        return { prompt: 'Use the computer', act: () => me && computer.open({ name: me.name, color: me.color, cash, owned, outfit, aptLevel: levelOf(mySlot) }) };
      }
      if (close(aptFridge(s, levelOf(s)), 1.7)) return { prompt: 'Open the fridge', act: fridgeDialog };
    } else if (zone === 'hall') {
      for (let s = 0; s < APT_SLOTS; s++) {
        if (!close(aptDoor(s), 1.4) || lobby.members.some((m) => m.slot === s)) continue;
        return note("A neighbour's door. Locked, and it smells of cabbage.");
      }
    } else if (zone === 'casino') {
      if (Math.hypot(player.pos.x - CASINO_DOOR.x, player.pos.z - CASINO_DOOR.z) < 2.4 && (run || ghost)) {
        return note(ghost ? 'The dead stay until the night is over.' : 'The doormen will let you out once you have cashed out.');
      }
      if (Math.hypot(player.pos.x - SECRET_DOOR.x, player.pos.z - SECRET_DOOR.z) < 2.6) {
        return {
          prompt: secret.open > 0.5 ? 'Push the bookcase shut' : 'Pull the red book',
          act: () => (secret.until = secret.open > 0.5 ? 0 : performance.now() / 1000 + 8),
        };
      }
      if (!ghost && run && close(CASHIER, 2.4)) return { prompt: 'Cash out at the cashier', act: cashierDialog };
      if (!ghost && run && atBar(player.pos)) return { prompt: 'Order at the bar', act: () => bar.open() };
      if (!ghost && run) {
        const seen = avatars.patronInView(player.pos, player.yaw, 3);
        const p = seen && patrons.get(seen.id);
        if (p && seen) {
          return seen.seated
            ? { prompt: `Have a word with ${p.name}`, act: () => evictDialog(p) }
            : { prompt: `Talk to ${p.name}`, act: () => inviteDialog(p) };
        }
      }
    }
    return null;
  }

  const lookDir = new THREE.Vector3();
  const toSeat = new THREE.Vector3();
  let use: Use | null = null;

  /** Find the free seat you are looking at, or the door you are standing at. */
  function updateAim() {
    let best: typeof aimedAt = null;
    if (world.zone === 'casino' && run && !ghost && !player.seated && !player.dead && !player.scripted) {
      lookDir.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      let bestDot = 0.82;
      for (const view of views.values()) {
        for (const spot of view.seats()) {
          if (spot.occupied) continue;
          toSeat.set(spot.x - player.pos.x, 0, spot.z - player.pos.z);
          if (toSeat.length() > 2.6) continue;
          const dot = toSeat.normalize().dot(lookDir);
          if (dot > bestDot) {
            bestDot = dot;
            best = { view, seat: spot.index };
          }
        }
      }
    }
    if (best?.view !== aimedAt?.view || best?.seat !== aimedAt?.seat) {
      aimedAt?.view.highlightSeat(null);
      aimedAt = best;
      best?.view.highlightSeat(best.seat);
    }
    use = best ? null : usable();
    if (best) hud.setPrompt(`Sit down · ${best.view.station.label}`);
    else hud.setPrompt(use?.prompt ?? null, use?.key !== false);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyE' || e.repeat || hud.menuOpen || hud.dialogOpen || hud.overlayOpen || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (player.seated || player.dead || player.scripted) return;
    e.preventDefault(); // or the E lands in a dialog's text box
    if (aimedAt) socket?.emit('sit', aimedAt.view.station.id, aimedAt.seat);
    else use?.act();
  });

  // ---- telling the server where we are ---------------------------------------

  const sent = { x: NaN, z: NaN, yaw: NaN, y: NaN };
  setInterval(() => {
    if (!me || !socket?.connected || player.seated || player.dead || player.scripted || player.isWaking) return;
    const { x, y, z } = player.pos;
    const yaw = player.yaw;
    const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
    if (same(x, sent.x) && same(z, sent.z) && same(yaw, sent.yaw) && same(y, sent.y)) return;
    Object.assign(sent, { x, z, yaw, y });
    socket.volatile.emit('move', x, z, yaw, y);
  }, 66);

  // ---- every frame -----------------------------------------------------------

  let last = performance.now();
  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const time = now / 1000;

    updateSecret(dt, time);
    if (player.active) {
      player.update(dt);
      // Walked through a doorway? You are somewhere else now (no teleport, no fade).
      if (!player.isWaking) setZone(player.dead || player.scripted ? myZone : zoneAt(player.pos));
      updateAim();
      const typing = document.activeElement?.tagName === 'INPUT';
      hud.setClickHint(!player.seated && !player.scripted && !player.dead && !player.isWaking && !player.mouseLocked && !typing && !hud.menuOpen && !hud.dialogOpen);
    } else {
      // Behind the login card: a slow drift around the casino floor.
      const a = time * 0.08;
      world.camera.position.set(Math.sin(a) * 9, 2.6, 6 + Math.cos(a) * 3);
      world.camera.lookAt(0, 1.8, -3);
    }

    const mode: ArmsMode =
      !player.active || player.dead || ghost || player.isWaking ? 'hidden' : player.scripted ? 'hands-up' : peeing ? 'pee' : player.seated ? 'seated' : 'walk';
    arms.update(dt, mode, { moving: player.moving, airborne: player.airborne, stride: player.stride, time });

    // Streams: yours from just in front of you, everyone else's from their characters.
    streams.update(dt, time, (id, s) => {
      if (id === me?.id) {
        if (!player.active || player.dead) return false;
        s.dir.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
        s.origin.set(player.pos.x + s.dir.x * 0.22, player.pos.y + 0.55, player.pos.z + s.dir.z * 0.22);
        return true;
      }
      return avatars.streamFrom(id, s.origin, s.dir);
    });

    // Drunk: the more ‰, the more the world sways, blurs and closes in.
    felt += (vitals.bac - felt) * (1 - Math.exp(-dt * 0.8));
    // Ice Water: steady as a rock, however much is in you.
    const drunkK = high('ice') ? 0 : Math.min(1, felt / 3);
    drunkLook(drunkK, time, high('third-eye'));

    if (world.zone === 'casino') {
      const people = avatars.positions();
      if (player.active && !player.dead && !ghost) people.push({ x: player.pos.x, z: player.pos.z });
      npcs.update(dt, time, people);
      for (const v of views.values()) v.update(dt, time);
    }
    escorts.update(dt, time);
    updateSelf();
    if (world.zone === 'street') dealers.update(time);
    if (Math.floor(time) !== Math.floor(time - dt)) hud.setEffects(effects); // the clocks tick down
    const meAt = player.active && !player.dead && !player.scripted && !ghost ? player.pos : null;
    doors.update(dt, meAt, avatars.positions(), opensFor);
    avatars.update(dt);
    world.update(dt, time);
    // The sway is added just for drawing, then taken off again, so it never builds up.
    const cam = world.camera;
    const k = drunkK;
    shake = Math.max(0, shake - dt);
    const jolt = shake > 0 ? Math.sin(time * 70) * shake * 0.12 : 0;
    const roll = Math.sin(time * 0.7) * 0.09 * k + Math.sin(time * 1.9) * 0.02 * k + jolt;
    const nod = Math.sin(time * 0.53) * 0.04 * k + jolt * 0.5;
    const turn = Math.sin(time * 0.41) * 0.05 * k;
    cam.rotation.z += roll;
    cam.rotation.x += nod;
    cam.rotation.y += turn;
    world.renderer.render(world.scene, cam);
    // Then what is in your hand, over the top, with its own depth so it never clips into things.
    arms.syncOverlay(cam);
    world.renderer.autoClear = false;
    world.renderer.clearDepth();
    world.renderer.render(arms.overlay, cam);
    world.renderer.autoClear = true;
    cam.rotation.z -= roll;
    cam.rotation.x -= nod;
    cam.rotation.y -= turn;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /** Blur, a dark soft edge, a breathing field of view, a walk that will not go straight. */
  let lastLook = -1;
  function drunkLook(k: number, time: number, seer: boolean) {
    player.drunk = k;
    const fov = 72 + Math.sin(time * 0.9) * 5 * k;
    if (Math.abs(world.camera.fov - fov) > 0.01) {
      world.camera.fov = fov;
      world.camera.updateProjectionMatrix();
    }
    const look = k + (seer ? 10 : 0);
    if (Math.abs(look - lastLook) < 0.01) return;
    lastLook = look;
    // Third Eye tints everything violet and makes it a little too vivid.
    const hue = k * -12 + (seer ? 38 : 0);
    canvas.style.filter = k > 0.03 || seer ? `blur(${(k * 2.4).toFixed(2)}px) saturate(${(1 + k * 0.7 + (seer ? 0.5 : 0)).toFixed(2)}) hue-rotate(${hue.toFixed(1)}deg)` : '';
    document.querySelector<HTMLElement>('#drunk-vignette')!.style.opacity = (k * 0.9).toFixed(2);
  }

  // Development only: lets you poke at the game from the browser console.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      casino: {
        world,
        player,
        avatars,
        views,
        escorts,
        npcs,
        arms,
        get socket() {
          return socket;
        },
        get lobby() {
          return lobby;
        },
        get ghost() {
          return ghost;
        },
        get vitals() {
          return vitals;
        },
        get peeing() {
          return peeing;
        },
      },
    });
  }

  // ---- start: straight in if we still have a valid login ------------------------

  if (token) {
    try {
      await api<{ user: AuthUser }>('me', { token });
      enterGame(token);
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      token = null;
      login.show();
    }
  } else {
    login.show();
  }
}

void boot();
