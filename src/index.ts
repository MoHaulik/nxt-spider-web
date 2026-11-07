import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { Game, GossamerSystem } from './game/game.js';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

World.create($('scene-container') as HTMLDivElement, projectOptions).then(async (world) => {
  world.registerSystem(GossamerSystem);

  const enter = $('enter') as HTMLButtonElement;
  const preview = $('preview') as HTMLButtonElement;
  const fresh = $('fresh') as HTMLButtonElement;
  const note = $('note');
  const ar = !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false));

  if (Game.hasSave()) {
    enter.textContent = 'Return to your web';
    fresh.hidden = false;
  }
  if (!ar) {
    enter.hidden = true;
    note.textContent = 'Open this page in the Meta Quest browser to play in your room. Here you can watch a preview: the mouse is your hand, hold the button to spin.';
  }

  const start = (desktop: boolean) => {
    const game = GossamerSystem.game!;
    $('landing').classList.add('gone');
    if (desktop) game.begin(true);
    else {
      game.audio.start(); // unlock audio inside the click
      world.launchXR();
    }
  };
  enter.onclick = () => start(false);
  preview.onclick = () => start(true);
  fresh.onclick = () => {
    Game.clearSave();
    location.reload();
  };
  world.visibilityState.subscribe((v) => {
    if (v === 'non-immersive' && GossamerSystem.game?.phase !== 'idle' && !GossamerSystem.game?.desktop) {
      $('landing').classList.remove('gone');
      enter.textContent = 'Return to your web';
    }
  });
});
