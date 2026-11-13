import './styles.css';

import { invoke } from '@tauri-apps/api/core';

import { Sfx } from './audio/Sfx';
import { GameLoop } from './engine/GameLoop';
import { loadPack, loadPackWith, type CompanionPack } from './engine/pack';
import { Particles } from './engine/Particles';
import { World } from './engine/World';
import { Companion } from './entities/Companion';
import { CompanionStats, type FoodKind, type ToyKind } from './entities/CompanionStats';
import { loadToyAtlas, ToyBox } from './entities/Toy';
import { backend, events, isTauri, type ProfileParams, type Settings, type TrayAction, type WorldSnapshot } from './platform/bridge';
import { HitboxSync } from './platform/HitboxSync';
import { HitRegistry } from './platform/HitRegistry';
import { Bubble } from './ui/Bubble';
import { DebugOverlay, fakeWorld } from './ui/DebugOverlay';
import { RadialMenu } from './ui/RadialMenu';
import { SettingsPanel } from './ui/SettingsPanel';
import { StatsPanel } from './ui/StatsPanel';
import { Aimer, NotePanel, showNotePopup } from './ui/Notes';
import { PackPanel } from './ui/PackPanel';
import { LobbyPanel } from './ui/LobbyPanel';
import { CombatDirector } from './network/CombatDirector';
import { Multiplayer } from './network/Multiplayer';
import { toBase64, type PackPayload } from './network/protocol';
import type { DesktopServices } from './entities/Companion';
import type { ToyBox as ToyBoxType } from './entities/Toy';
import { ToyBoxPanel } from './ui/ToyBoxPanel';
import { Console } from './ui/Panel';
import { applyAccentFrom } from './ui/theme';

const DEFAULT_PACK_URL = '/companions/default/';
const DEFAULT_PACK_ID = 'dev.default.byte';

/** Pack appliqué ; en cas de problème (pack supprimé, corrompu), le robot par défaut. */
async function loadActivePack(id: string | null): Promise<{ pack: CompanionPack; error: string | null }> {
  if (id && id !== DEFAULT_PACK_ID) {
    try {
      return { pack: await loadPackWith((file) => backend.packFile(id, file)), error: null };
    } catch (err) {
      console.warn('[pack]', err);
      return { pack: await loadPack(DEFAULT_PACK_URL), error: `Le pack « ${id} » n’a pas pu être chargé.` };
    }
  }
  return { pack: await loadPack(DEFAULT_PACK_URL), error: null };
}
const SAVE_INTERVAL_MS = 30_000;

const rand = (min: number, max: number): number => min + Math.random() * (max - min);
const pickGreeting = (items: readonly string[]): string => items[Math.floor(Math.random() * items.length)] ?? items[0] ?? '';

async function bootstrap(): Promise<void> {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('#stage introuvable');
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  const debug = !isTauri || new URLSearchParams(window.location.search).has('debug');
  const initial = await backend.getSettings();
  const activePackId = initial.settings.activePack;
  const [{ pack, error: packError }, toyAtlas, backendWorld, savedRaw] = await Promise.all([
    loadActivePack(initial.settings.activePack),
    loadToyAtlas(),
    backend.getWorld(),
    backend.loadCompanion(),
  ]);
  applyAccentFrom(pack.image, pack.manifest.accentColor);
  let settings: Settings = initial.settings;
  let currentProfile: ProfileParams = initial.profile;

  // --- Monde, services, entités ---------------------------------------------------
  const world = new World();
  let snapshot: WorldSnapshot = backendWorld ?? fakeWorld();
  world.update(snapshot);
  const debugOverlay = debug ? new DebugOverlay(stage) : null;

  const particles = new Particles(stage);
  const sfx = new Sfx();
  const applyProfile = (profile: ProfileParams, s: Settings): void => {
    particles.enabled = profile.particles;
    sfx.setEnabled(s.behaviors.sounds);
  };
  applyProfile(initial.profile, settings);

  const restored = CompanionStats.restore(savedRaw);
  const stats = restored ?? CompanionStats.create(pack.manifest.id, pack.manifest.name, pack.manifest.baseStats);

  let loop: GameLoop | null = null; // créée après les entités, mais réveillable dès leur construction
  const wake = (): void => loop?.wake();

  // Plusieurs objets peuvent être tenus ou ouverts : le mode interactif est compté.
  let captures = 0;
  const capture = (on: boolean): void => {
    captures = Math.max(0, captures + (on ? 1 : -1));
    backend.setPointerCapture(captures > 0).catch(console.warn);
  };

  const toys = new ToyBox(stage, toyAtlas, world, {
    onDragStateChanged: capture,
    requestWake: wake,
    onOpenNote: (note) => {
      // Double-clic : la boule disparaît et le mot s'affiche à sa place.
      note.squash();
      showNotePopup(stage, note.text || '…', note.x, note.y - note.body.height);
      particles.emit('sparkle', note.x, note.y - note.body.height, true);
      sfx.play('pop');
    },
  });
  const desktop: DesktopServices = {
    icons: () => backend.desktopIcons(),
    moveIcon: (index, x, y) => backend.moveDesktopIcon(index, x, y),
    nudgeWindow: (id, edge, dx) => backend.nudgeWindow(id, edge, dx),
    poke: (x, y) => backend.pokeScreen(x, y),
  };
  // Créé plus bas, mais ses méthodes peuvent être appelées dès la construction du compagnon.
  let mp: Multiplayer | null = null;
  const bubble = new Bubble(stage, () => companion.bubbleAnchor());
  const companion: Companion = new Companion(
    stage,
    pack,
    {
      desktop,
      world,
      toys,
      stats,
      particles,
      sfx,
      say: (text, seconds) => bubble.say(text, seconds),
      onDragStateChanged: capture,
      onDoubleClick: () => openRadial(),
      requestWake: wake,
      onCross: (c, side) => mp?.crossCompanion(c, side),
    },
    { behaviors: settings.behaviors, profile: initial.profile },
  );
  toys.restore(stats.data.toys);

  // --- Actions de soin --------------------------------------------------------------
  const floorNear = (x: number): { x: number; y: number } => {
    const b = world.bounds;
    const cx = Math.min(Math.max(x, b.left + 60), b.right - 60);
    const floor = world.floorAt(cx) ?? world.floors[0];
    return { x: cx, y: (floor?.y ?? b.bottom) - 40 };
  };

  /** Emplacement libre près du compagnon (les jouets ne se superposent pas). */
  const freeSpotX = (): number => {
    const base = companion.body.x;
    const taken = toys.items.map((t) => t.x);
    for (let i = 0; i < 12; i++) {
      const side = (i % 2 === 0 ? companion.facing : -companion.facing) as number;
      const x = base + side * (150 + Math.floor(i / 2) * 80 + rand(0, 20));
      const p = floorNear(x);
      if (Math.abs(p.x - x) < 1 && taken.every((tx) => Math.abs(tx - x) > 70)) return x;
    }
    return base + companion.facing * rand(140, 260);
  };

  const placeToy = (kind: ToyKind): void => {
    const p = floorNear(freeSpotX());
    toys.spawn(kind, p.x, p.y, kind === 'bowl' ? 'kibble' : null);
    stats.interact();
    wake();
  };

  const feed = (food: FoodKind): void => {
    if (food === 'kibble') {
      const bowl = toys.find('bowl');
      if (bowl) bowl.fill('kibble');
      else placeToy('bowl');
    } else {
      // L'aliment tombe du ciel juste à côté du compagnon.
      const x = companion.body.x + companion.facing * rand(60, 110);
      toys.spawn('food', x, companion.body.y - companion.h * 2.5, food);
    }
    particles.emit('food', companion.body.x, companion.body.y - companion.h, true);
    stats.interact();
    wake();
  };

  // --- Interfaces ---------------------------------------------------------------------
  const center = (): { x: number; y: number } => {
    const floor = world.floorAt(companion.body.x) ?? world.floors[0];
    const cx = floor ? (floor.x1 + floor.x2) / 2 : window.innerWidth / 2;
    return { x: cx, y: (floor?.y ?? window.innerHeight) * 0.45 };
  };
  // La Console regroupe toutes les rubriques ; l'ordre de création fixe celui des onglets.
  const hub = new Console(stage, wake, () => stats.data.name);
  new StatsPanel(hub, companion);
  const toyPanel = new ToyBoxPanel(hub, toys, { place: placeToy, feed, releaseBug: () => toys.spawnBug() });
  // Note en boule de papier : écrire, viser, il la lance.
  const aimer = new Aimer(stage);
  const notePanel = new NotePanel(
    stage,
    (text) => {
      capture(true);
      aimer.start(
        () => ({ x: companion.body.x, y: companion.body.y - companion.h * 0.7 }),
        (vx, vy) => {
          companion.fsm.go('throw', { vx, vy, text });
          wake();
        },
        () => capture(false),
      );
      wake();
    },
    (enabled) => {
      backend.setKeyboardFocus(enabled).catch(console.warn);
    },
    wake,
  );

  const packPanel = new PackPanel(
    hub,
    () => settings.activePack ?? DEFAULT_PACK_ID,
    (id) => {
      // Les statistiques sont sauvegardées, puis l'overlay recharge le nouveau pack.
      save(true);
      const next = { ...settings, activePack: id === DEFAULT_PACK_ID ? null : id };
      backend
        .updateSettings(next)
        .then(() => window.setTimeout(() => window.location.reload(), 300))
        .catch(console.warn);
    },
  );

  // --- Multijoueur ---------------------------------------------------------------
  const readOwnPackFile = (file: string): Promise<ArrayBuffer> =>
    activePackId && activePackId !== DEFAULT_PACK_ID
      ? backend.packFile(activePackId, file)
      : fetch(`${DEFAULT_PACK_URL}${file}`).then((r) => r.arrayBuffer());
  let packPayload: Promise<PackPayload> | null = null;
  const myPack = (): Promise<PackPayload> =>
    (packPayload ??= (async () => {
      const text = async (file: string): Promise<string> => new TextDecoder().decode(await readOwnPackFile(file));
      return {
        manifest: await text('manifest.json'),
        animations: await text('animations.json'),
        sheet: toBase64(await readOwnPackFile(pack.manifest.sprite.file)),
      };
    })());

  const devLog = (tag: string) =>
    import.meta.env.DEV ? (m: string) => void invoke('debug_log', { message: `[${tag}] ${m}` }).catch(() => undefined) : undefined;
  const director = new CombatDirector({
    stage,
    particles,
    sfx,
    wake,
    onEnd: (winner, loser) => {
      // Le propriétaire d'un compagnon en visite est prévenu de l'issue du combat.
      for (const [c, won] of [[winner, true], [loser, false]] as const) {
        const owner = multiplayer.ownerOf(c);
        if (owner) {
          multiplayer.room.send({
            type: 'notice',
            to: owner.id,
            text: `⚔️ ${c.stats.data.name} a combattu chez ${stats.data.name} : ${won ? 'victoire ! 🏆' : 'défaite…'}`,
          });
        }
      }
    },
    ...(devLog('combat') ? { log: devLog('combat')! } : {}),
  });
  const multiplayer = new Multiplayer({
    stage,
    world,
    toys,
    particles,
    sfx,
    desktop,
    director,
    me: () => companion,
    myName: () => stats.data.name,
    myPack,
    settings: () => ({ behaviors: settings.behaviors, profile: currentProfile }),
    capture,
    wake,
    say: (text, seconds) => bubble.say(text, seconds),
    openVisitorMenu: (c) => openVisitorMenu(c),
    onChanged: () => {
      lobby.setAway(multiplayer.awayAtName);
      lobby.render();
    },
    onRooms: (rooms) => lobby.setRooms(rooms),
    ...(devLog('salon') ? { log: devLog('salon')! } : {}),
  });
  mp = multiplayer;
  const lobby: LobbyPanel = new LobbyPanel(
    hub,
    multiplayer.room,
    {
      create: () => void multiplayer.room.create().then(() => lobby.say('Salon ouvert : partage le code')).catch((e: unknown) => lobby.say(String(e))),
      join: (target) => {
        lobby.say('Connexion…');
        multiplayer.room.join(target).then(() => lobby.say('')).catch((e: unknown) => lobby.say(String(e)));
      },
      leave: () => void multiplayer.room.leave(),
      recall: () => multiplayer.recall(),
      browse: (on) => void multiplayer.room.browse(on),
      keyboard: (enabled) => {
        backend.setKeyboardFocus(enabled).catch(console.warn);
      },
    },
  );
  const settingsPanel = new SettingsPanel(hub, settings);

  /** Menu radial d'un compagnon en visite (celui d'un autre joueur). */
  const openVisitorMenu = (c: Companion): void => {
    if (radial.isOpen) return radial.close();
    const r = c.hitRect();
    if (!r) return;
    const owner = multiplayer.ownerOf(c);
    const here = !companion.away;
    radial.open({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, [
      {
        icon: 'pet',
        label: `Caresser ${c.stats.data.name}`,
        action: () => {
          c.petActiveUntil = performance.now() + 2500;
          c.fsm.interrupt('pet', 20);
          wake();
        },
      },
      {
        icon: 'treat',
        label: 'Friandise',
        action: () => {
          toys.spawn('food', c.body.x + c.facing * 70, c.body.y - c.h * 2.5, 'cookie');
          wake();
        },
      },
      {
        icon: 'fight',
        label: here ? `Combattre ${c.stats.data.name}` : `${stats.data.name} est absent`,
        action: () => {
          if (!here) return companion.say('Je suis chez un ami !', 2);
          if (director.active) return c.say('Un combat est déjà en cours !', 2);
          director.start(companion, c);
        },
      },
      {
        icon: 'home',
        label: `Renvoyer chez ${owner?.name ?? 'lui'}`,
        action: () => multiplayer.sendHome(c),
      },
    ]);
  };

  const radial = new RadialMenu(stage, (open) => {
    companion.openMenu(open);
    wake();
  });

  const openRadial = (): void => {
    if (radial.isOpen) return radial.close();
    const r = companion.hitRect();
    if (!r) return;
    radial.open({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, [
      { icon: 'bowl', label: 'Nourrir', action: () => feed('kibble') },
      { icon: 'treat', label: 'Friandise', action: () => feed('cookie') },
      {
        icon: 'ball',
        label: 'Jouer',
        action: () => {
          if (!toys.has('ball')) placeToy('ball');
          companion.fsm.go('play_ball');
        },
      },
      {
        icon: 'sleep',
        label: 'Sieste',
        action: () => {
          if (stats.needs.energy > 85) companion.say('Pas sommeil ! 😤', 2);
          else companion.fsm.go('sleep');
        },
      },
      { icon: 'note', label: 'Note', action: () => notePanel.open(center()) },
      { icon: 'toys', label: 'Jouets', action: () => toyPanel.open(center()) },
      { icon: 'console', label: 'Console', action: () => hub.open(center()) },
    ]);
  };

  // --- Hit-test : tout ce qui doit recevoir la souris --------------------------------
  const registry = new HitRegistry(new HitboxSync((rects) => backend.setHitboxes(rects), 100));
  registry.add(() => companion.hitRect());
  registry.add(() => toys.hitRects());
  registry.add(() => radial.hitRect());
  registry.add(() => hub.hitRect());
  registry.add(() => notePanel.hitRect());
  registry.add(() => multiplayer.hitRects());
  registry.add(() => aimer.hitRect());

  const gameLoop = new GameLoop([toys, companion, multiplayer, director, bubble, registry], initial.profile);
  loop = gameLoop;

  // --- Sauvegarde -------------------------------------------------------------------
  const save = (force = false): void => {
    if (!stats.takeDirty() && !force) return;
    stats.setToys(toys.serialize());
    stats.takeDirty();
    backend.saveCompanion(stats.snapshot()).catch((err: unknown) => console.warn('[save]', err));
  };
  let saveSoon: number | undefined;
  toys.onChange(() => {
    window.clearTimeout(saveSoon);
    saveSoon = window.setTimeout(() => save(true), 2000);
  });
  window.setInterval(() => save(), SAVE_INTERVAL_MS);

  // --- Événements du backend --------------------------------------------------------
  const applyWorld = (next: WorldSnapshot): void => {
    snapshot = next;
    world.update(next);
    companion.onWorldChanged();
    for (const v of multiplayer.visitorList()) v.onWorldChanged();
    toys.onWorldChanged();
    multiplayer.onWorldChanged();
    debugOverlay?.draw(world, next);
  };
  debugOverlay?.draw(world, snapshot);

  const trayActions: Record<TrayAction, () => void> = {
    feed: () => feed('kibble'),
    toys: () => toyPanel.toggle(center()),
    settings: () => settingsPanel.toggle(center()),
    multiplayer: () => lobby.toggle(center()),
  };

  await Promise.all([
    events.onSettingsChanged(({ settings: next, profile }) => {
      settings = next;
      gameLoop.setTiming(profile);
      currentProfile = profile;
      companion.setProfile(profile);
      companion.setBehaviors(next.behaviors);
      multiplayer.setSettings(next.behaviors, profile);
      applyProfile(profile, next);
      settingsPanel.update(next);
      backend.setCursorTracking(next.behaviors.mouseInteractions).catch(console.warn);
    }),
    events.onTrayAction((action) => {
      trayActions[action]();
      gameLoop.wake();
    }),
    events.onVisibilityChanged((visible) => {
      if (!visible) return gameLoop.stop();
      gameLoop.start();
      if (!companion.away) companion.greet(pickGreeting(['Coucou ! 👋', 'Me revoilà !', 'Tu m’as manqué !']));
    }),
    events.onCursorMoved(({ x, y, near }) => companion.onCursor(x, y, near)),
    events.onWorldChanged(applyWorld),
    events.onFlushSave(() => save(true)),
    multiplayer.init(),
    events.onAutostartChanged((enabled) => settingsPanel.setAutostart(enabled)),
    events.onFileDrop(
      (drop) => {
        const pack = drop.files.find((f) => f.name.toLowerCase().endsWith('.companion'));
        if (pack) {
          packPanel.open(center());
          void packPanel.importFile(pack);
          return;
        }
        const name = drop.names[0];
        if (!name) return;
        backend
          .desktopIconForName(name)
          .catch(() => null)
          .then((iconIndex) => {
            companion.receiveFile(name, iconIndex ?? null);
            gameLoop.wake();
          });
      },
      // Dépôt accepté seulement sur lui (ou tout près).
      (x, y) => {
        if (packPanel.contains(x, y)) return true;
        const r = companion.hitRect();
        const m = 30;
        return !!r && x > r.x - m && x < r.x + r.w + m && y > r.y - m && y < r.y + r.h + m;
      },
      () => companion.expectFile(),
    ),
  ]);
  backend.setCursorTracking(settings.behaviors.mouseInteractions).catch(console.warn);

  if (!isTauri) window.addEventListener('resize', () => applyWorld(fakeWorld()));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      save(true);
      gameLoop.stop();
    } else {
      gameLoop.start();
    }
  });

  if (debug) {
    Object.assign(window, {
      __companionDebug: { world, companion, stats, toys, applyWorld, feed, placeToy, snapshot: () => snapshot },
    });
  }

  if (import.meta.env.DEV && isTauri) {
    startDiagnostics(companion, gameLoop);
    void startAutotest(multiplayer, director, companion, toys, world);
  }

  gameLoop.start();
  if (packError) bubble.say(packError, 5);
  // Coucou d'apparition, joué dès qu'il a atterri.
  if (!restored) {
    companion.greet(`Coucou ! Je suis ${stats.data.name}.\nDouble-clique sur moi !`);
    save(true);
  } else {
    const greetings: Record<string, string> = {
      affamé: 'Coucou ! J’ai un petit creux… 🍖',
      fatigué: 'Coucou… *bâille*',
      boudeur: 'Ah. Te revoilà.',
      triste: 'Coucou ! Tu m’as manqué !',
    };
    companion.greet(greetings[stats.mood()] ?? 'Coucou ! >_');
  }
}

/**
 * Diagnostic de cadence (dev uniquement) : toutes les 15 s, part du temps par état et
 * cadence demandée à la boucle, affichées dans la console de `npm run tauri dev`.
 */
function startDiagnostics(companion: Companion, loop: GameLoop): void {
  const states = new Map<string, number>();
  const loopActivity = { active: 0, idle: 0, dormant: 0 };
  window.setInterval(() => {
    states.set(companion.state, (states.get(companion.state) ?? 0) + 1);
    loopActivity[loop.currentActivity]++;
  }, 250);
  window.setInterval(() => {
    const total = [...states.values()].reduce((a, b) => a + b, 0) || 1;
    const top = [...states.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const msg =
      `loop=${JSON.stringify(loopActivity)} ` +
      top.map(([k, v]) => `${k}:${Math.round((100 * v) / total)}%`).join(' ');
    invoke('debug_log', { message: msg }).catch(() => undefined);
    states.clear();
    loopActivity.active = loopActivity.idle = loopActivity.dormant = 0;
  }, 15_000);
}

/**
 * Pilote de test multijoueur (dev uniquement, `DC_AUTOTEST=host|join|pack`) :
 * « host » crée un salon, attend un visiteur et lance un combat avec lui ; « join »
 * rejoint le salon, lance une note puis son compagnon par le bord gauche (relié à
 * l'hôte), puis le rappelle. Tout est journalisé dans la console Rust.
 */
async function startAutotest(
  mp: Multiplayer,
  director: CombatDirector,
  companion: Companion,
  toys: ToyBoxType,
  world: World,
): Promise<void> {
  const mode = await invoke<string | null>('dev_autotest').catch(() => null);
  if (!mode) return;
  const log = (text: string): void => void invoke('debug_log', { message: `[autotest:${mode}] ${text}` }).catch(() => undefined);
  const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
  log('démarrage');
  if (mode === 'pack') {
    // Import par la vraie chaîne IPC (corps binaire), puis relecture du pack installé.
    for (const name of ['byte-sakura', 'pack-invalide']) {
      const bytes = new Uint8Array(await (await fetch(`/__test/${name}.companion`)).arrayBuffer());
      try {
        const info = await backend.importCompanion(bytes);
        const pack = await loadPackWith((file) => backend.packFile(info.id, file));
        log(`${name} : importé (${info.name} v${info.version}), planche ${pack.image.naturalWidth}×${pack.image.naturalHeight}, ${Object.keys(pack.animations).length} animations`);
      } catch (err) {
        const list = Array.isArray(err) ? err : [String(err)];
        log(`${name} : refusé, ${list.length} erreur(s) — ${list.slice(0, 3).join(' | ')}`);
      }
    }
    log(`packs installés : ${(await backend.listPacks()).map((p) => p.id).join(', ')}`);
    return;
  }
  const waitFor = async (what: string, test: () => boolean, seconds: number): Promise<boolean> => {
    for (let i = 0; i < seconds * 4; i++) {
      if (test()) return true;
      await sleep(250);
    }
    log(`ÉCHEC : ${what} (après ${seconds} s)`);
    return false;
  };
  const links = (): string =>
    Object.entries(mp.room.myLinks())
      .map(([s, id]) => `${s}→${mp.room.player(id!)?.name}`)
      .join(', ') || 'aucun';

  if (mode === 'host') {
    await mp.room.create();
    log(`salon créé, code ${mp.room.code}`);
    if (!(await waitFor('second joueur', () => mp.room.players.length >= 2, 60))) return;
    log(`joueurs : ${mp.room.players.map((p) => p.name).join(', ')} ; mes bords : ${links()}`);
    if (!(await waitFor('visiteur', () => mp.visitorList().length > 0, 60))) return;
    const visitor = mp.visitorList()[0]!;
    log(`visiteur présent : ${visitor.stats.data.name} ; notes reçues : ${toys.items.filter((t) => t.kind === 'note').map((t) => t.text).join(' | ') || 'aucune'}`);
    // Secoué avant de traverser : il doit arriver étourdi.
    const states = new Set<string>();
    for (let i = 0; i < 24; i++) {
      states.add(visitor.fsm.name);
      await sleep(250);
    }
    log(`états du visiteur après l'arrivée : ${[...states].join(', ')} → ${states.has('dizzy') ? 'OK étourdi' : 'ÉCHEC pas étourdi'}`);
    // Jouet reçu : notre compagnon doit pouvoir jouer avec.
    const ball = toys.items.find((t) => t.kind === 'ball' && t.owner !== '');
    log(`balle reçue : ${ball ? `oui (x=${Math.round(ball.x)}, posée=${ball.body.grounded})` : 'non'} ; find → ${toys.find('ball') === ball ? 'la balle reçue' : 'autre'}`);
    if (ball) {
      const x0 = ball.x;
      companion.fsm.go('play_ball');
      const seen = new Set<string>();
      let moved = 0;
      for (let i = 0; i < 40; i++) {
        seen.add(companion.fsm.name);
        moved = Math.max(moved, Math.abs(ball.x - x0));
        await sleep(250);
      }
      log(`jeu avec la balle reçue : états ${[...seen].join(', ')}, déplacement max ${Math.round(moved)} px → ${moved > 30 ? 'OK' : 'ÉCHEC'}`);
    }
    // Note reçue : un double-clic l'ouvre et elle disparaît.
    const note = toys.items.find((t) => t.kind === 'note');
    if (note) {
      (note as unknown as { layer: { canvas: HTMLCanvasElement } }).layer.canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await sleep(500);
      const popup = document.querySelectorAll('.note-popup').length;
      log(`note ouverte : retirée=${!toys.items.includes(note)}, papier affiché=${popup}`);
      await sleep(9000);
      log(`papier après sa durée : ${document.querySelectorAll('.note-popup').length} restant(s)`);
    }
    await sleep(1000);
    log(`combat lancé : ${director.start(companion, visitor)}`);
    await waitFor('fin du combat', () => !director.active, 90);
    await waitFor('rappel du visiteur', () => mp.visitorList().length === 0, 60);
    log('le visiteur est rentré chez lui');
    return;
  }

  // « join » : trouve le salon, le rejoint, puis envoie une note et son compagnon par le bord gauche.
  let roomId: string | null = null;
  const stop = await events.onRooms((rooms) => {
    if (!roomId && rooms[0]) {
      roomId = rooms[0].id;
      log(`salon trouvé : ${rooms[0].name} @ ${rooms[0].address}`);
    }
  });
  await mp.room.browse(true);
  await waitFor('salon à proximité', () => roomId !== null, 30);
  stop();
  if (!roomId) return;
  await mp.room.join(roomId);
  if (!(await waitFor('placement reçu', () => !!mp.room.myLinks().left, 20))) return;
  log(`mes bords : ${links()}`);
  const b = world.bounds;
  const floorY = world.floors[0]?.y ?? b.bottom;
  const note = toys.spawn('note', b.left + 80, floorY - 120);
  note.text = 'Coucou par-dessus le bord !';
  note.body.crossLinks = true;
  note.kick(-1100, -250);
  log('note lancée vers la gauche');
  await sleep(1500);
  const ball = toys.spawn('ball', b.left + 120, floorY - 120);
  ball.body.crossLinks = true;
  ball.kick(-1200, -300);
  log('balle lancée vers la gauche');
  await sleep(2500);
  companion.body.x = b.left + 90;
  companion.body.y = floorY - 160;
  companion.fling(-1200, -300);
  companion.makeQueasy(); // comme après une secousse puis un lancer
  log(`compagnon secoué : ${companion.queasy}`);
  log(`compagnon lancé vers la gauche (force ${companion.stats.stats.strength.toFixed(2)})`);
  if (!(await waitFor('départ du compagnon', () => companion.away, 10))) return;
  log(`compagnon parti chez ${mp.awayAtName}`);
  await sleep(75000); // le temps des vérifications et du combat chez l’hôte
  mp.recall();
  log('rappel envoyé');
  if (!(await waitFor('retour du compagnon', () => !companion.away, 20))) return;
  log(`compagnon revenu : force ${companion.stats.stats.strength.toFixed(2)}, endurance ${companion.stats.stats.endurance.toFixed(2)}, bonheur ${companion.stats.needs.happiness.toFixed(1)}, entraînements ${companion.stats.data.counters.trainings}`);
}

bootstrap().catch((err: unknown) => console.error('[bootstrap]', err));
