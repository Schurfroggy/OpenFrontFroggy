import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  homeHref,
  renderDuration,
  renderNumber,
  renderTroops,
  translateText,
} from "../../../client/Utils";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  GameMode,
  GameType,
  PlayerType,
  RankedType,
} from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { AllPlayersStats } from "../../../core/Schemas";
import {
  ATTACK_INDEX_SENT,
  GOLD_INDEX_DONATE_RECV,
  GOLD_INDEX_STEAL,
  GOLD_INDEX_TRADE,
  GOLD_INDEX_TRAIN_OTHER,
  GOLD_INDEX_TRAIN_SELF,
  GOLD_INDEX_WAR,
  GOLD_INDEX_WORK,
  OTHER_INDEX_BUILT,
  PLAYER_INDEX_NATION,
  PlayerStats,
} from "../../../core/StatsSchemas";
import { Controller } from "../../Controller";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { recordSelfHostedAchievement } from "../../SelfHostedAchievements";
import {
  PlaySoundEffectEvent,
  PlayVictoryMusicEvent,
} from "../../sound/Sounds";
import { SendWinnerEvent } from "../../Transport";
import { GameView } from "../../view";

const ICONS = {
  rank: assetUrl("images/CrownIcon.svg"),
  time: assetUrl("images/ReplayRegularIconWhite.svg"),
  killer: assetUrl("images/TargetIconWhite.svg"),
  territory: assetUrl("images/ClaimIcon.svg"),
  troops: assetUrl("images/SoldierIcon.svg"),
  attack: assetUrl("images/SwordIconWhite.svg"),
  conquest: assetUrl("images/LeaderboardIconSolidWhite.svg"),
  city: assetUrl("images/CityIconWhite.svg"),
  defp: assetUrl("images/ShieldIconWhite.svg"),
  port: assetUrl("images/PortIcon.svg"),
  fact: assetUrl("images/FactoryIconWhite.svg"),
  silo: assetUrl("images/MissileSiloIconWhite.svg"),
  saml: assetUrl("images/SamLauncherIconWhite.svg"),
  warship: assetUrl("images/BattleshipIconWhite.svg"),
  workers: assetUrl("images/WorkerIconWhite.svg"),
  war: assetUrl("images/SwordIconWhite.svg"),
  trade: assetUrl("images/TradeShipIconWhite.svg"),
  piracy: assetUrl("images/BoatIconWhite.png"),
  train: assetUrl("images/FactoryIconWhite.svg"),
  donation: assetUrl("images/DonateGoldIconWhite.svg"),
  gold: assetUrl("images/GoldCoinIcon.svg"),
} as const;

const BUILDINGS = [
  ["city", "unit_type.city", ICONS.city],
  ["defp", "unit_type.defense_post", ICONS.defp],
  ["port", "unit_type.port", ICONS.port],
  ["fact", "unit_type.factory", ICONS.fact],
  ["silo", "unit_type.missile_silo", ICONS.silo],
  ["saml", "unit_type.sam_launcher", ICONS.saml],
] as const;

@customElement("win-modal")
export class WinModal extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  private hasShownDeathModal = false;
  private achievementRecorded = false;

  @state()
  isVisible = false;

  @state()
  private isWin = false;

  @state()
  private isRankedGame = false;

  private _title: string;
  private resultStats: PlayerStats;
  private allResultStats: AllPlayersStats = {};
  private resultDurationSeconds = 0;
  private defeatedByName: string | null = null;
  private defeatedByTeam: string | null = null;
  private defeatedByType: PlayerType | null = null;
  private finalPosition: number | null = null;
  private isCancelled = false;

  // Override to prevent shadow DOM creation
  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
  }

  render() {
    return html`
      <div
        class="${this.isVisible
          ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800/70 p-4 md:p-6 shrink-0 rounded-lg z-[10010] shadow-2xl backdrop-blur-xs text-white w-[min(90vw,700px)] max-w-[90%] max-h-[90dvh] overflow-hidden flex flex-col"
          : "hidden"}"
      >
        <h2 class="m-0 mb-4 text-[26px] text-center text-white shrink-0">
          ${this._title || ""}
        </h2>
        <div class="min-h-0 flex-1 overflow-y-auto pr-0.5">
          ${this.innerHtml()}
        </div>
        <div class="mt-4 flex justify-between gap-2.5 shrink-0">
          <o-button
            variant="primary"
            width="block"
            class="flex-1"
            translationKey="win_modal.exit"
            @click=${this._handleExit}
          ></o-button>
          ${this.isRankedGame
            ? html`
                <o-button
                  variant="primary"
                  width="block"
                  class="flex-1"
                  translationKey="win_modal.requeue"
                  @click=${this._handleRequeue}
                ></o-button>
              `
            : null}
          <o-button
            variant="primary"
            width="block"
            class="flex-1"
            .title=${this.game?.myPlayer()?.isAlive()
              ? translateText("win_modal.keep")
              : translateText("win_modal.spectate")}
            @click=${this.hide}
          ></o-button>
        </div>
      </div>
    `;
  }

  private statCard(
    icon: string,
    label: string,
    value: string,
    wide = false,
  ): TemplateResult {
    return html`
      <div
        class="${wide
          ? "sm:col-span-2"
          : ""} flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-3 shadow-inner"
      >
        <div
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sky-400/10 ring-1 ring-sky-300/15"
        >
          <img class="h-7 w-7 object-contain" src=${icon} alt="" />
        </div>
        <div class="min-w-0">
          <div
            class="text-[11px] font-bold uppercase tracking-wider text-white/45"
          >
            ${label}
          </div>
          <div class="mt-0.5 truncate text-base font-bold text-white">
            ${value}
          </div>
        </div>
      </div>
    `;
  }

  private isTeamGame(): boolean {
    return this.game.config().gameConfig().gameMode === GameMode.Team;
  }

  private statAt(values: readonly bigint[] | undefined, index: number): bigint {
    return values?.[index] ?? 0n;
  }

  private formatShare(tiles: bigint, totalLand: number): string {
    if (totalLand <= 0) return "0%";
    const percentage = (Number(tiles) / totalLand) * 100;
    return `${percentage.toFixed(1)}%`;
  }

  private teamStats(): NonNullable<PlayerStats>[] {
    const myTeam = this.game.myPlayer()?.team();
    if (myTeam === null || myTeam === undefined) return [];
    return this.game
      .playerViews()
      .filter((player) => player.team() === myTeam)
      .map((player) => {
        const clientID = player.clientID();
        return clientID === null ? undefined : this.allResultStats[clientID];
      })
      .filter(
        (stats): stats is NonNullable<PlayerStats> => stats !== undefined,
      );
  }

  private sumTeam(read: (stats: NonNullable<PlayerStats>) => bigint): bigint {
    return this.teamStats().reduce((sum, stats) => sum + read(stats), 0n);
  }

  private defeatedByText(): string {
    if (this.defeatedByName === null && this.defeatedByTeam !== null) {
      return translateText("win_modal.stats.team_killer", {
        team: this.defeatedByTeam,
      });
    }
    if (this.defeatedByName === null) {
      return translateText("win_modal.stats.unknown_killer");
    }
    if (this.defeatedByType === PlayerType.Nation) {
      return translateText("win_modal.stats.nation_killer", {
        name: this.defeatedByName,
      });
    }
    if (this.defeatedByType === PlayerType.Bot) {
      return translateText("win_modal.stats.bot_killer", {
        name: this.defeatedByName,
      });
    }
    if (this.isTeamGame() && this.defeatedByTeam !== null) {
      return translateText("win_modal.stats.player_team_killer", {
        name: this.defeatedByName,
        team: this.defeatedByTeam,
      });
    }
    return this.defeatedByName;
  }

  private renderDefeatStats(): TemplateResult {
    const position =
      this.finalPosition === null
        ? translateText("win_modal.stats.unranked")
        : translateText("win_modal.stats.place_value", {
            place: this.finalPosition,
          });
    return html`
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        ${this.statCard(
          ICONS.rank,
          translateText("win_modal.stats.final_place"),
          position,
        )}
        ${this.statCard(
          ICONS.time,
          translateText("win_modal.stats.survival_time"),
          renderDuration(this.resultDurationSeconds),
        )}
        ${this.statCard(
          ICONS.killer,
          translateText("win_modal.stats.defeated_by"),
          this.defeatedByText(),
          true,
        )}
      </div>
    `;
  }

  private renderBuildings(stats: NonNullable<PlayerStats>): TemplateResult {
    return html`
      <section class="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
        <h3
          class="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/70"
        >
          <img class="h-5 w-5" src=${ICONS.city} alt="" />
          ${translateText("win_modal.stats.construction")}
        </h3>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          ${BUILDINGS.map(
            ([key, label, icon]) => html`
              <div
                class="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2"
              >
                <img
                  class="h-6 w-6 shrink-0 object-contain"
                  src=${icon}
                  alt=""
                />
                <div class="min-w-0">
                  <div class="truncate text-xs text-white/50">
                    ${translateText(label)}
                  </div>
                  <div class="font-bold tabular-nums text-white">
                    ${renderNumber(
                      this.statAt(stats.units?.[key], OTHER_INDEX_BUILT),
                    )}
                  </div>
                </div>
              </div>
            `,
          )}
        </div>
      </section>
    `;
  }

  private renderEconomy(stats: NonNullable<PlayerStats>): TemplateResult {
    const rows = [
      ["win_modal.stats.gold_workers", ICONS.workers, GOLD_INDEX_WORK],
      ["win_modal.stats.gold_war", ICONS.war, GOLD_INDEX_WAR],
      ["win_modal.stats.gold_trade", ICONS.trade, GOLD_INDEX_TRADE],
      ["win_modal.stats.gold_piracy", ICONS.piracy, GOLD_INDEX_STEAL],
      ["win_modal.stats.gold_own_trains", ICONS.train, GOLD_INDEX_TRAIN_SELF],
      [
        "win_modal.stats.gold_other_trains",
        ICONS.train,
        GOLD_INDEX_TRAIN_OTHER,
      ],
      [
        "win_modal.stats.gold_donations",
        ICONS.donation,
        GOLD_INDEX_DONATE_RECV,
      ],
    ] as const;
    const values = rows.map(([label, icon, index]) => ({
      label,
      icon,
      value: this.statAt(stats.gold, index),
    }));
    const total = values.reduce((sum, row) => sum + row.value, 0n);

    return html`
      <section class="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
        <h3
          class="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/70"
        >
          <img class="h-5 w-5" src=${ICONS.gold} alt="" />
          ${translateText("win_modal.stats.economy")}
        </h3>
        <div class="space-y-3">
          ${values.map((row) => {
            const share =
              total === 0n ? 0 : (Number(row.value) / Number(total)) * 100;
            return html`
              <div>
                <div
                  class="mb-1 flex items-center justify-between gap-3 text-xs"
                >
                  <span class="flex min-w-0 items-center gap-2 text-white/65">
                    <img
                      class="h-4 w-4 shrink-0 object-contain"
                      src=${row.icon}
                      alt=""
                    />
                    <span class="truncate">${translateText(row.label)}</span>
                  </span>
                  <span
                    class="shrink-0 font-semibold tabular-nums text-white/90"
                  >
                    ${renderNumber(row.value)} · ${share.toFixed(1)}%
                  </span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-white/8">
                  <div
                    class="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-300"
                    style=${`width: ${share}%`}
                  ></div>
                </div>
              </div>
            `;
          })}
        </div>
      </section>
    `;
  }

  private renderVictoryStats(): TemplateResult {
    const stats = this.resultStats;
    if (stats === undefined) return html``;
    const totalLand = Math.max(
      0,
      this.game.numLandTiles() - this.game.numTilesWithFallout(),
    );
    const finalTiles = stats.finalTiles ?? 0n;
    const peakTiles = this.statAt(stats.tiles, 0);
    const attacks = this.statAt(stats.attacks, ATTACK_INDEX_SENT);
    const nations = this.statAt(stats.conquests, PLAYER_INDEX_NATION);
    const isTeam = this.isTeamGame();
    const myTeam = this.game.myPlayer()?.team();
    const teamFinalTiles = isTeam
      ? BigInt(
          this.game
            .playerViews()
            .filter((player) => player.team() === myTeam)
            .reduce((sum, player) => sum + player.numTilesOwned(), 0),
        )
      : 0n;
    const teamAttacks = isTeam
      ? this.sumTeam((member) => this.statAt(member.attacks, ATTACK_INDEX_SENT))
      : 0n;
    const teamNations = isTeam
      ? this.sumTeam((member) =>
          this.statAt(member.conquests, PLAYER_INDEX_NATION),
        )
      : 0n;

    return html`
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        ${this.statCard(
          ICONS.time,
          translateText("win_modal.stats.match_duration"),
          renderDuration(this.resultDurationSeconds),
        )}
        ${this.statCard(
          ICONS.territory,
          translateText("win_modal.stats.final_territory"),
          `${renderNumber(finalTiles)} · ${this.formatShare(finalTiles, totalLand)}`,
        )}
        ${isTeam
          ? this.statCard(
              ICONS.territory,
              translateText("win_modal.stats.team_final_territory"),
              `${renderNumber(teamFinalTiles)} · ${this.formatShare(teamFinalTiles, totalLand)}`,
            )
          : nothing}
        ${this.statCard(
          ICONS.territory,
          translateText("win_modal.stats.peak_territory"),
          renderNumber(peakTiles),
        )}
        ${this.statCard(
          ICONS.troops,
          translateText("win_modal.stats.peak_troops"),
          renderTroops(Number(stats.peakTroops ?? 0n)),
        )}
        ${this.statCard(
          ICONS.attack,
          translateText("win_modal.stats.attack_troops"),
          renderTroops(Number(attacks)),
        )}
        ${isTeam
          ? this.statCard(
              ICONS.attack,
              translateText("win_modal.stats.team_attack_troops"),
              renderTroops(Number(teamAttacks)),
            )
          : nothing}
        ${this.statCard(
          ICONS.conquest,
          translateText("win_modal.stats.nations_conquered"),
          renderNumber(nations),
        )}
        ${isTeam
          ? this.statCard(
              ICONS.conquest,
              translateText("win_modal.stats.team_nations_conquered"),
              renderNumber(teamNations),
            )
          : nothing}
        ${this.statCard(
          ICONS.warship,
          translateText("win_modal.stats.warships_built"),
          renderNumber(this.statAt(stats.units?.wshp, OTHER_INDEX_BUILT)),
        )}
      </div>
      ${this.renderBuildings(stats)} ${this.renderEconomy(stats)}
    `;
  }

  innerHtml(): TemplateResult {
    if (this.isCancelled) {
      return html`
        <div
          class="flex items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-4 text-amber-100"
        >
          <img class="h-8 w-8" src=${ICONS.time} alt="" />
          <span>${translateText("win_modal.match_cancelled")}</span>
        </div>
      `;
    }
    return this.isWin ? this.renderVictoryStats() : this.renderDefeatStats();
  }

  show() {
    crazyGamesSDK.gameplayStop();
    this.isRankedGame =
      this.game.config().gameConfig().rankedType !== undefined;
    this.isVisible = true;
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }

  private _handleExit() {
    this.hide();
    window.location.href = homeHref();
  }

  private _handleRequeue() {
    this.hide();
    // Requeue for the same mode; Main owns the mechanism (currently a
    // reload with the requeue param, which reopens the queue after the
    // page teardown).
    document.dispatchEvent(
      new CustomEvent("matchmaking-requeue", {
        detail: {
          mode:
            this.game.config().gameConfig().rankedType === RankedType.TwoVTwo
              ? ("2v2" as const)
              : ("1v1" as const),
        },
      }),
    );
  }

  init() {}

  tick() {
    const myPlayer = this.game.myPlayer();
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this.isCancelled = false;
      this.isWin = false;
      this.resultDurationSeconds = this.game.elapsedGameSeconds();
      this.finalPosition = myPlayer.deathPosition();
      this.defeatedByName = myPlayer.killedByName();
      this.defeatedByTeam = myPlayer.killedByTeam();
      this.defeatedByType = myPlayer.killedByType();
      this._title = translateText("win_modal.died");
      this.eventBus.emit(new PlaySoundEffectEvent("defeat"));
      this.show();
    }
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates?.[GameUpdateType.Win] ?? [];
    winUpdates.forEach((wu) => {
      this.allResultStats = wu.allPlayersStats;
      if (!this.hasShownDeathModal) {
        this.resultDurationSeconds = this.game.elapsedGameSeconds();
      }
      const myClientID = myPlayer?.clientID();
      this.resultStats =
        myClientID === null || myClientID === undefined
          ? undefined
          : wu.allPlayersStats[myClientID];
      this.finalPosition = myPlayer?.deathPosition() ?? this.finalPosition;
      this.isCancelled = false;
      if (wu.winner === undefined) {
        // Match cancelled (e.g. a ranked 2v2 that didn't fill or fully
        // spawn): the game ends with no winner. Still vote the result to the
        // server so the record is archived winnerless (never ranked).
        this.eventBus.emit(new SendWinnerEvent(undefined, wu.allPlayersStats));
        this._title = translateText("win_modal.match_cancelled");
        this.isWin = false;
        this.isCancelled = true;
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      } else if (wu.winner[0] === "team") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this._title = translateText("win_modal.your_team");
          this.isWin = true;
          this.resultDurationSeconds = this.game.elapsedGameSeconds();
          this.recordAchievement();
          crazyGamesSDK.happytime();
        } else {
          this._title = translateText("win_modal.other_team", {
            team: wu.winner[1],
          });
          this.isWin = false;
          if (!this.hasShownDeathModal) {
            this.defeatedByName = null;
            this.defeatedByTeam = wu.winner[1];
            this.defeatedByType = null;
          }
        }
        this.playEndOfGameSound();
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      } else if (wu.winner[0] === "nation") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        this._title = translateText("win_modal.nation_won", {
          nation: wu.winner[1],
        });
        this.isWin = false;
        if (!this.hasShownDeathModal) {
          this.defeatedByName = wu.winner[1];
          this.defeatedByTeam = null;
          this.defeatedByType = PlayerType.Nation;
        }
        this.playEndOfGameSound();
        this.show();
      } else {
        const winner = this.game.playerByClientID(wu.winner[1]);
        if (!winner?.isPlayer()) return;
        const winnerClient = winner.clientID();
        if (winnerClient !== null) {
          this.eventBus.emit(
            new SendWinnerEvent(["player", winnerClient], wu.allPlayersStats),
          );
        }
        if (
          winnerClient !== null &&
          winnerClient === this.game.myPlayer()?.clientID()
        ) {
          this._title = translateText("win_modal.you_won");
          this.isWin = true;
          this.recordAchievement();
          crazyGamesSDK.happytime();
        } else {
          this._title = translateText("win_modal.other_won", {
            player: winner.displayName(),
          });
          this.isWin = false;
          if (!this.hasShownDeathModal) {
            this.defeatedByName = winner.displayName();
            this.defeatedByTeam = winner.team();
            this.defeatedByType = winner.type();
          }
        }
        this.playEndOfGameSound();
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      }
    });
  }

  private recordAchievement(): void {
    if (this.achievementRecorded) return;
    const player = this.game.myPlayer();
    const config = this.game.config().gameConfig();
    if (
      player === undefined ||
      player === null ||
      config.selfHostedAchievementsEnabled !== true ||
      (config.gameType !== GameType.Singleplayer &&
        config.gameType !== GameType.Private)
    ) {
      return;
    }
    this.achievementRecorded = true;
    void recordSelfHostedAchievement({
      playerName: player.displayName(),
      mapName: config.gameMap,
      difficulty: config.difficulty,
      source:
        config.gameType === GameType.Singleplayer
          ? "singleplayer"
          : "multiplayer",
      gameId: this.game.gameID(),
    });
  }

  private playEndOfGameSound(): void {
    if (this.isWin) {
      this.eventBus.emit(new PlayVictoryMusicEvent());
      this.eventBus.emit(new PlaySoundEffectEvent("victory"));
    } else if (!this.hasShownDeathModal && this.game.myPlayer()?.hasSpawned()) {
      // Spawned check: spectators and replay viewers shouldn't get a
      // personal defeat sting. The cue also already played if the player
      // died earlier (hasShownDeathModal).
      this.eventBus.emit(new PlaySoundEffectEvent("defeat"));
    }
  }
}
