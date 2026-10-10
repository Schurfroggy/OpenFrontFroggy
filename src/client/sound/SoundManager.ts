import { Howl } from "howler";
import { assetUrl } from "../../core/AssetUrls";
import { EventBus } from "../../core/EventBus";
import { AudioMixer, PlayableCategory } from "./AudioMixer";
import { fadeInMusic } from "./MusicFade";
import {
  AmbienceTrack,
  ambienceUrls,
  PlaySoundEffectEvent,
  PlayVictoryMusicEvent,
  SetAmbienceEvent,
  SoundEffect,
} from "./Sounds";

const AMBIENCE_FADE_MS = 500;
const MUSIC_GAP_MS = 10_000;
const FIRE_MUSIC_AFTER_SECONDS = 15 * 60;
const PLAYING_TRACKS = [
  "Playing1.mp3",
  "Playing2.mp3",
  "Playing3.mp3",
  "Playing4.mp3",
  "Playing5.mp3",
].map((name) => assetUrl(`sounds/music/${name}`));
const FIRE_TRACKS = ["Fire1.mp3", "Fire2.mp3", "Fire3.mp3"].map((name) =>
  assetUrl(`sounds/music/${name}`),
);
const WINNING_TRACK = assetUrl("sounds/music/Winning.mp3");

function shuffleTracks(
  tracks: readonly string[],
  avoidFirst?: string,
): string[] {
  const shuffled = [...tracks];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  if (
    avoidFirst !== undefined &&
    shuffled.length > 1 &&
    shuffled[0] === avoidFirst
  ) {
    [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
  }
  return shuffled;
}

/**
 * The audio a running game owns: its phase-aware music playlist and structure
 * ambience. Cue playback, channel volumes and concurrency budgets all live in
 * AudioMixer, which outlives any one game.
 */
export class SoundManager {
  private backgroundMusic: Howl | null = null;
  private backgroundMusicEndHandler: (() => void) | null = null;
  private cancelMusicFadeIn: (() => void) | null = null;
  private musicGapTimer: ReturnType<typeof setTimeout> | null = null;
  private musicStarted = false;
  private victoryMusicStarted = false;
  private musicPhase: "playing" | "fire" = "playing";
  private musicPlaylist: string[] = [];
  private musicPlaylistIndex = 0;
  private lastMusicTrack: string | undefined;
  private disposed = false;
  private ambienceTracks = new Map<AmbienceTrack, Howl>();
  private currentAmbience: AmbienceTrack | null = null;
  private fadingOut = new Set<Howl>();
  private fadingIn = new Set<Howl>();
  private onPlaySoundEffect: (e: PlaySoundEffectEvent) => void;
  private onPlayVictoryMusic: (e: PlayVictoryMusicEvent) => void;
  private onSetAmbience: (e: SetAmbienceEvent) => void;
  private stopFollowingVolume: () => void;

  constructor(
    private readonly eventBus: EventBus,
    private readonly mixer: AudioMixer,
    private readonly elapsedGameSeconds: () => number = () => 0,
  ) {
    this.onPlaySoundEffect = (e) => {
      // Victory replaces the playlist through PlayVictoryMusicEvent. Defeat
      // is a short cue instead, so explicitly end the Playing/Fire playlist
      // before the cue starts or both tracks overlap on the result screen.
      if (e.effect === "defeat") this.stopBackgroundMusic();
      this.mixer.play(e.effect);
    };
    this.onPlayVictoryMusic = () => this.playVictoryMusic();
    this.onSetAmbience = (e) => this.setAmbience(e.track, e.gain);
    eventBus.on(PlaySoundEffectEvent, this.onPlaySoundEffect);
    eventBus.on(PlayVictoryMusicEvent, this.onPlayVictoryMusic);
    eventBus.on(SetAmbienceEvent, this.onSetAmbience);

    // Ambience is crossfaded here rather than registered with the mixer, so
    // the mixer cannot stomp a fade in progress. Re-target on every change.
    this.stopFollowingVolume = this.mixer.onChange((category) => {
      if (category === "ambience") this.retargetAmbience();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.eventBus.off(PlaySoundEffectEvent, this.onPlaySoundEffect);
    this.eventBus.off(PlayVictoryMusicEvent, this.onPlayVictoryMusic);
    this.eventBus.off(SetAmbienceEvent, this.onSetAmbience);
    this.stopFollowingVolume();
    this.clearMusicGap();
    this.releaseBackgroundMusic();
    this.ambienceTracks.forEach((sound) => {
      this.safely("stop ambience track", () => sound.stop());
      this.safely("unload ambience track", () => sound.unload());
    });
    this.ambienceTracks.clear();
    this.fadingOut.clear();
    this.fadingIn.clear();
    this.currentAmbience = null;
  }

  private safely(action: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.warn(`SoundManager: failed to ${action}`, err);
    }
  }

  public playBackgroundMusic(): void {
    if (this.musicStarted || this.disposed) return;
    this.musicStarted = true;
    this.victoryMusicStarted = false;
    this.musicPhase = "playing";
    this.musicPlaylist = shuffleTracks(PLAYING_TRACKS);
    this.musicPlaylistIndex = 0;
    this.playNextBackgroundTrack();
  }

  public stopBackgroundMusic(): void {
    this.musicStarted = false;
    this.clearMusicGap();
    this.releaseBackgroundMusic();
  }

  private playNextBackgroundTrack(): void {
    if (!this.musicStarted || this.victoryMusicStarted || this.disposed) return;

    if (
      this.musicPhase === "playing" &&
      this.elapsedGameSeconds() >= FIRE_MUSIC_AFTER_SECONDS
    ) {
      this.musicPhase = "fire";
      this.musicPlaylist = shuffleTracks(FIRE_TRACKS, this.lastMusicTrack);
      this.musicPlaylistIndex = 0;
    }

    const sourceTracks =
      this.musicPhase === "playing" ? PLAYING_TRACKS : FIRE_TRACKS;
    if (this.musicPlaylistIndex >= this.musicPlaylist.length) {
      this.musicPlaylist = shuffleTracks(sourceTracks, this.lastMusicTrack);
      this.musicPlaylistIndex = 0;
    }

    const track = this.musicPlaylist[this.musicPlaylistIndex++];
    this.lastMusicTrack = track;
    this.playMusicTrack(track, () => this.scheduleNextBackgroundTrack());
  }

  private scheduleNextBackgroundTrack(): void {
    if (!this.musicStarted || this.victoryMusicStarted || this.disposed) return;
    this.clearMusicGap();
    this.musicGapTimer = setTimeout(() => {
      this.musicGapTimer = null;
      this.playNextBackgroundTrack();
    }, MUSIC_GAP_MS);
  }

  private playVictoryMusic(): void {
    if (this.victoryMusicStarted || this.disposed) return;
    this.victoryMusicStarted = true;
    this.clearMusicGap();
    this.playMusicTrack(WINNING_TRACK);
  }

  private playMusicTrack(track: string, onEnd?: () => void): void {
    this.releaseBackgroundMusic();
    this.safely("play background music", () => {
      const music = new Howl({
        src: [track],
        loop: false,
        volume: 0,
        html5: true,
      });
      const handleEnd = () => {
        if (this.backgroundMusic !== music) return;
        this.releaseBackgroundMusic();
        onEnd?.();
      };
      this.backgroundMusic = music;
      this.backgroundMusicEndHandler = handleEnd;
      this.cancelMusicFadeIn = fadeInMusic(music, this.mixer);
      music.once("end", handleEnd);
      music.play();
    });
  }

  private clearMusicGap(): void {
    if (this.musicGapTimer === null) return;
    clearTimeout(this.musicGapTimer);
    this.musicGapTimer = null;
  }

  private releaseBackgroundMusic(): void {
    const music = this.backgroundMusic;
    if (music === null) return;
    if (this.backgroundMusicEndHandler !== null) {
      music.off("end", this.backgroundMusicEndHandler);
    }
    this.backgroundMusicEndHandler = null;
    this.cancelMusicFadeIn?.();
    this.cancelMusicFadeIn = null;
    this.mixer.unregister(music);
    this.safely("stop background music", () => music.stop());
    this.safely("unload background music", () => music.unload());
    this.backgroundMusic = null;
  }

  /** Kept for callers that still reach for it; the mixer owns cue playback. */
  public playSoundEffect(name: SoundEffect): void {
    this.mixer.play(name);
  }

  // ------------------------------------------------------------- ambience

  public setAmbience(track: AmbienceTrack | null, gain: number = 1): void {
    // Same track, so there is nothing to cross over: the gain is the whole
    // update and the mixer's change listener retargets the running loop.
    if (track === this.currentAmbience) {
      this.mixer.setAmbienceEnvelope(gain);
      return;
    }
    this.safely("set ambience", () => {
      // The outgoing loop has to start fading from the level it is audibly at,
      // so the new envelope lands *after* it. Leaving ambience range always
      // arrives as (null, 0); pushing that gain in first would run the mixer's
      // change listener back through retargetAmbience(), snap the outgoing
      // loop to silence, and turn the fade below into a hard cut.
      this.fadeOutCurrent();
      this.mixer.setAmbienceEnvelope(gain);
      this.currentAmbience = track;
      if (track === null) return;

      const target = this.mixer.volumeFor("ambience");
      const howl = this.getOrLoadAmbience(track);
      if (howl === null) return;
      // Cancel a pending fade-out stop in case this track is coming straight
      // back; if it is still audibly fading, keep the running instance rather
      // than layering a second one on top.
      howl.off("fade");
      this.fadingOut.delete(howl);
      if (!howl.playing()) howl.play();
      // Howler's fade only completes while the volume is moving toward the
      // target, so any fade whose start equals its end hangs and leaks its
      // interval. Zero is the common case, but panning between two structures
      // at a constant zoom can also re-enter with the loop already at target.
      const from = howl.volume() as number;
      if (target === 0 || from === target) {
        this.fadingIn.delete(howl);
        howl.volume(target);
      } else {
        this.fadeInTo(howl, from, target);
      }
    });
  }

  /**
   * Ramps a loop up to `target` and remembers that it is moving, so a volume
   * change arriving mid-ramp can re-aim it instead of cutting it short.
   */
  private fadeInTo(howl: Howl, from: number, target: number): void {
    this.fadingIn.add(howl);
    howl.fade(from, target, AMBIENCE_FADE_MS);
    howl.once("fade", () => this.fadingIn.delete(howl));
  }

  /**
   * Follows the ambience channel while a loop is already running: the zoom
   * envelope moves every tick, and the slider can move at any time.
   *
   * Neither direction of an in-flight fade may be cut short by this. Howler's
   * volume() setter calls _stopFade internally, so a plain write lands the
   * loop on the new level instantly -- which is the abruptness the fades are
   * here to avoid. A fade-out is left alone; it is on its way to silence
   * whatever the envelope now says. A fade-in is re-aimed from wherever the
   * ramp has actually reached, so it stays smooth and still ends up at the
   * level the envelope is asking for.
   */
  private retargetAmbience(): void {
    if (this.currentAmbience === null) return;
    const howl = this.ambienceTracks.get(this.currentAmbience);
    if (howl === undefined || this.fadingOut.has(howl)) return;
    this.safely("retarget ambience", () => {
      const target = this.mixer.volumeFor("ambience");
      if (!this.fadingIn.has(howl)) {
        howl.volume(target);
        return;
      }
      const live = howl.volume() as number;
      // Drop the old ramp's completion handler before starting another, or it
      // would clear the fading-in flag out from under the new one.
      howl.off("fade");
      this.fadingIn.delete(howl);
      // Same trap as everywhere else: a fade from a value to itself never
      // completes in Howler. Landing on the target is all that is left to do.
      if (live === target) {
        howl.volume(target);
        return;
      }
      this.fadeInTo(howl, live, target);
    });
  }

  private fadeOutCurrent(): void {
    if (this.currentAmbience === null) return;
    const current = this.ambienceTracks.get(this.currentAmbience);
    if (current === undefined) return;
    // Whatever it was doing, it is leaving now.
    this.fadingIn.delete(current);
    const from = current.volume() as number;
    if (from === 0) {
      current.stop();
      // Flagged even though there is no fade to protect. setAmbience pushes
      // the new envelope in right after this, which runs the mixer's change
      // listener back through retargetAmbience() while currentAmbience is
      // still this outgoing track -- and with nothing to stop it, that stamps
      // the stopped loop with the INCOMING track's level. A later revisit
      // then reads that stale value as its starting volume, and if it happens
      // to equal the target it plays at full level instead of fading in.
      this.fadingOut.add(current);
      return;
    }
    this.fadingOut.add(current);
    current.fade(from, 0, AMBIENCE_FADE_MS);
    current.once("fade", () => {
      current.stop();
      this.fadingOut.delete(current);
    });
  }

  private getOrLoadAmbience(name: AmbienceTrack): Howl | null {
    const cached = this.ambienceTracks.get(name);
    if (cached) return cached;
    const src = ambienceUrls.get(name);
    if (!src) return null;
    try {
      const sound = new Howl({ src: [src], loop: true, volume: 0 });
      this.ambienceTracks.set(name, sound);
      return sound;
    } catch (err) {
      console.warn(`SoundManager: failed to load ambience ${name}`, err);
      return null;
    }
  }
}

export type { PlayableCategory };
