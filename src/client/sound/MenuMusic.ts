import { Howl } from "howler";
import { assetUrl } from "../../core/AssetUrls";
import { AudioMixer } from "./AudioMixer";
import { fadeInMusic } from "./MusicFade";

const MENU_TRACK = assetUrl("sounds/music/MainTitle.mp3");
const TRACK_GAP_MS = 10_000;
const MENU_FADE_OUT_MS = 700;

/**
 * Plays MainTitle in the menu. Each pass fades in, finishes naturally, waits
 * ten seconds, then starts again. Browsers require the first play to happen
 * after a user gesture, so the first pass (and a pass after returning from a
 * lobby) remains gesture-armed.
 */
export function startMenuMusic(mixer: AudioMixer): void {
  let theme: Howl | null = null;
  let replayTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelFadeIn: (() => void) | null = null;
  let menuActive = true;

  const clearReplayTimer = () => {
    if (replayTimer === null) return;
    clearTimeout(replayTimer);
    replayTimer = null;
  };

  const onEnded = () => {
    if (theme === null) return;
    cancelFadeIn?.();
    cancelFadeIn = null;
    mixer.unregister(theme);
    if (!menuActive) return;
    replayTimer = setTimeout(playPass, TRACK_GAP_MS);
  };

  const playPass = () => {
    if (!menuActive || theme === null) return;
    clearReplayTimer();
    cancelFadeIn?.();
    mixer.unregister(theme);
    cancelFadeIn = fadeInMusic(theme, mixer);
    theme.once("end", onEnded);
    theme.play();
  };

  const start = () => {
    if (!menuActive || theme !== null) return;
    try {
      theme = new Howl({
        src: [MENU_TRACK],
        loop: false,
        volume: 0,
        html5: true,
      });
      playPass();
    } catch (error) {
      console.warn("Failed to play menu theme", error);
    }
  };

  const disarm = () => {
    document.removeEventListener("pointerdown", start);
    document.removeEventListener("keydown", start);
  };

  const arm = () => {
    disarm();
    document.addEventListener("pointerdown", start, { once: true });
    document.addEventListener("keydown", start, { once: true });
  };

  arm();

  document.addEventListener("game-starting", () => {
    menuActive = false;
    disarm();
    clearReplayTimer();
    if (theme === null) return;
    const ending = theme;
    theme = null;
    ending.off("end", onEnded);
    cancelFadeIn?.();
    cancelFadeIn = null;
    mixer.unregister(ending);

    const from = ending.volume() as number;
    if (!ending.playing() || from === 0) {
      ending.stop();
      ending.unload();
      return;
    }
    ending.fade(from, 0, MENU_FADE_OUT_MS);
    ending.once("fade", () => {
      ending.stop();
      ending.unload();
    });
  });

  document.addEventListener("menu-restored", () => {
    menuActive = true;
    arm();
  });
}
