import type { Howl } from "howler";
import type { AudioMixer } from "./AudioMixer";

const MUSIC_FADE_IN_MS = 2000;
const MUSIC_FADE_IN_FLOOR_DB = -48;
const MUSIC_FADE_IN_STEP_MS = 25;

function rampGain(target: number, progress: number): number {
  return target * 10 ** ((MUSIC_FADE_IN_FLOOR_DB * (1 - progress)) / 20);
}

/**
 * Fades a music stream in with an even perceptual (dB) ramp, then hands its
 * volume back to the shared mixer. The returned function cancels a pending or
 * in-progress ramp; callers still own stopping and unloading the Howl.
 */
export function fadeInMusic(howl: Howl, mixer: AudioMixer): () => void {
  let rampTimer: ReturnType<typeof setInterval> | null = null;
  let active = true;

  function removeListeners() {
    howl.off("play", onPlay);
    howl.off("playerror", onPlayError);
  }

  function settle() {
    if (!active) return;
    if (rampTimer !== null) {
      clearInterval(rampTimer);
      rampTimer = null;
    }
    removeListeners();
    mixer.register(howl, "music");
  }

  function beginRamp() {
    if (!active) return;
    if (!mixer.isAudible("music")) {
      settle();
      return;
    }
    const startedAt = performance.now();
    howl.volume(rampGain(mixer.volumeFor("music"), 0));
    rampTimer = setInterval(() => {
      const progress = Math.min(
        1,
        (performance.now() - startedAt) / MUSIC_FADE_IN_MS,
      );
      if (progress >= 1) {
        settle();
        return;
      }
      howl.volume(rampGain(mixer.volumeFor("music"), progress));
    }, MUSIC_FADE_IN_STEP_MS);
  }

  function onPlay() {
    beginRamp();
  }

  function onPlayError() {
    settle();
  }

  howl.volume(rampGain(mixer.volumeFor("music"), 0));
  howl.once("play", onPlay);
  howl.once("playerror", onPlayError);

  return () => {
    if (!active) return;
    active = false;
    if (rampTimer !== null) {
      clearInterval(rampTimer);
      rampTimer = null;
    }
    removeListeners();
  };
}
