import './styles.css';

import { GameLoop } from './engine/GameLoop';
import { loadPack } from './engine/pack';
import { World } from './engine/World';
import { Companion } from './entities/Companion';
import { backend, events, isTauri, type TrayAction, type WorldSnapshot } from './platform/bridge';
import { HitboxSync } from './platform/HitboxSync';
import { Bubble } from './ui/Bubble';
import { DebugOverlay, fakeWorld } from './ui/DebugOverlay';

const DEFAULT_PACK_URL = '/companions/default/';

const TRAY_MESSAGES: Record<TrayAction, string> = {
  feed: 'Miam ! (les soins arrivent à l’étape 3)',
  toys: 'Des jouets ? Bientôt ! (étape 3)',
  multiplayer: 'Le multijoueur P2P arrive à l’étape 4',
  settings: 'Le panneau de réglages arrive à l’étape 3',
};

async function bootstrap(): Promise<void> {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('#stage introuvable');

  // Pas de menu contextuel natif sur l'overlay.
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  const debug = !isTauri || new URLSearchParams(window.location.search).has('debug');
  const [initial, pack, backendWorld] = await Promise.all([
    backend.getSettings(),
    loadPack(DEFAULT_PACK_URL),
    backend.getWorld(),
  ]);

  const world = new World();
  let snapshot: WorldSnapshot = backendWorld ?? fakeWorld();
  world.update(snapshot);
  const debugOverlay = debug ? new DebugOverlay(stage) : null;

  // Chaque envoi traverse renderer → navigateur → app : 10 Hz suffisent (cf. Companion.render).
  const hitboxes = new HitboxSync((rects) => backend.setHitboxes(rects), 100);
  // Créée après le compagnon, mais ses hooks peuvent être appelés dès son constructeur.
  let loop: GameLoop | null = null;
  const companion: Companion = new Companion(
    stage,
    pack,
    world,
    { behaviors: initial.settings.behaviors, profile: initial.profile },
    {
      onHitboxChanged: (rect) => hitboxes.update([rect]),
      onDragStateChanged: (dragging) => {
        backend.setPointerCapture(dragging).catch(console.warn);
      },
      onDoubleClick: () => bubble.say('Menu radial : étape 3 !'),
      onAnimEvent: () => undefined, // sons et particules : étape 3
      requestWake: () => loop?.wake(),
    },
  );
  const bubble = new Bubble(stage, () => companion.bubbleAnchor());
  const gameLoop = new GameLoop([companion, bubble], initial.profile);
  loop = gameLoop;

  const applyWorld = (next: WorldSnapshot): void => {
    snapshot = next;
    world.update(next);
    companion.onWorldChanged();
    debugOverlay?.draw(world, next);
  };
  debugOverlay?.draw(world, snapshot);
  if (debug) {
    // Accès console pour les tests manuels : __companionDebug.applyWorld({...}), etc.
    Object.assign(window, { __companionDebug: { world, companion, applyWorld, snapshot: () => snapshot } });
  }

  await Promise.all([
    events.onSettingsChanged(({ settings, profile }) => {
      gameLoop.setTiming(profile);
      companion.setProfile(profile);
      companion.setBehaviors(settings.behaviors);
    }),
    events.onTrayAction((action) => {
      bubble.say(TRAY_MESSAGES[action]);
      gameLoop.wake();
    }),
    events.onVisibilityChanged((visible) => (visible ? gameLoop.start() : gameLoop.stop())),
    events.onWorldChanged(applyWorld),
  ]);

  if (!isTauri) window.addEventListener('resize', () => applyWorld(fakeWorld()));

  // Une webview masquée ne doit consommer aucun cycle.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) gameLoop.stop();
    else gameLoop.start();
  });

  gameLoop.start();
  bubble.say(isTauri ? 'Bonjour ! >_' : 'Mode navigateur (monde factice)');
}

bootstrap().catch((err: unknown) => console.error('[bootstrap]', err));
