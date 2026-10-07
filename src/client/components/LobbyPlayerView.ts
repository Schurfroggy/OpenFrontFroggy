import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import {
  ColoredTeams,
  Duos,
  GameMode,
  HumansVsNations,
  PlayerInfo,
  PlayerType,
  Quads,
  Team,
  Trios,
} from "../../core/game/Game";
import { assignTeamsLobbyPreview } from "../../core/game/TeamAssignment";
import { UserSettings } from "../../core/game/UserSettings";
import {
  ClientID,
  ClientInfo,
  TeamAssignmentPreset,
  TeamCountConfig,
} from "../../core/Schemas";
import { createRandomName, formatPlayerDisplayName } from "../../core/Util";
import { Theme, themeProvider } from "../theme/ThemeProvider";
import {
  getTranslatedPlayerTeamLabel,
  resolveTeamClanTag,
  translateText,
} from "../Utils";

export interface TeamPreviewData {
  team: Team;
  players: ClientInfo[];
  clanTag?: string | null;
}

@customElement("lobby-player-view")
export class LobbyTeamView extends LitElement {
  @property({ type: String }) gameMode: GameMode = GameMode.FFA;
  @property({ type: Array }) clients: ClientInfo[] = [];
  @state() private teamPreview: TeamPreviewData[] = [];
  @state() private teamMaxSize: number = 0;
  @property({ type: String }) lobbyCreatorClientID: string = "";
  @property({ type: String }) currentClientID: string = "";
  @property({ attribute: "team-count" }) teamCount: TeamCountConfig = 2;
  @property({ type: Function }) onKickPlayer?: (clientID: string) => void;
  @property({ type: Function }) onToggleNameReveal?: (clientID: string) => void;
  @property({ type: Array }) nameReveals: string[] = [];
  @property({ type: Boolean }) anonymizeNames: boolean = false;
  @property({ type: Number }) nationCount: number = 0;
  @property({ type: Boolean }) isPublicGame: boolean = false;
  @property({ type: Boolean }) canManageAllTeams: boolean = false;
  @property({ type: Boolean }) allowPlayerTeamSelection: boolean = false;
  @property({ type: Boolean }) teamEditingLocked: boolean = false;
  @property({ type: Function }) onAssignPlayerTeam?: (
    clientID: ClientID,
    teamIndex: number | null,
  ) => void;
  @property({ type: Function }) onApplyTeamPreset?: (
    preset: TeamAssignmentPreset,
  ) => void;
  @property({ type: Function }) onAllowPlayerTeamSelectionChanged?: (
    allowed: boolean,
  ) => void;

  private get theme(): Theme {
    return themeProvider.current();
  }
  @state() private showTeamColors: boolean = false;
  @state() private teamMenuClientID: ClientID | null = null;
  @state() private dragOverTeamIndex: number | null = null;
  // dataTransfer can be cleared when Lit re-renders a team card during
  // dragover. Retain the controlled player explicitly for the whole gesture.
  private draggingClientID: ClientID | null = null;
  private longPressTimer: number | null = null;
  private longPressClientID: ClientID | null = null;
  private longPressActive = false;
  private longPressStart = { x: 0, y: 0 };
  private _clanUpdateTimeout: number | null = null;
  private _teamClanTags: Map<Team, string | null> = new Map();
  private _viewerFriends: ReadonlySet<ClientID> = new Set();

  // Spectators are in the lobby roster (flagged) but hold no seat and never
  // reach the simulation — so the count header, the team preview and both
  // player lists show PLAYERS only, and spectators get their own bubble below.
  private get activePlayers(): ClientInfo[] {
    return this.clients.filter((c) => !c.spectator);
  }
  private get spectators(): ClientInfo[] {
    return this.clients.filter((c) => c.spectator === true);
  }
  private userSettings: UserSettings = new UserSettings();

  /**
   * For public HumansVsNations games, nation count always matches human count
   * (server enforces this in NationCreation). For private games, the host
   * controls the nation count via the slider.
   */
  private get effectiveNationCount(): number {
    if (this.isPublicGame && this.teamCount === HumansVsNations) {
      return this.activePlayers.length;
    }
    return this.nationCount;
  }

  willUpdate(changedProperties: Map<string, any>) {
    if (
      changedProperties.has("clients") ||
      changedProperties.has("currentClientID")
    ) {
      const self = this.currentClientID
        ? this.clients.find((c) => c.clientID === this.currentClientID)
        : undefined;
      this._viewerFriends = new Set(self?.friends ?? []);
    }
    // Recompute team preview when relevant properties change
    // clients is updated from WebSocket lobby_info events
    if (
      changedProperties.has("gameMode") ||
      changedProperties.has("clients") ||
      changedProperties.has("teamCount") ||
      changedProperties.has("nationCount") ||
      changedProperties.has("isPublicGame")
    ) {
      const teamsList = this.getTeamList();
      this.computeTeamPreview(teamsList);
      this.showTeamColors = teamsList.length <= 7;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._clanUpdateTimeout !== null) {
      window.clearTimeout(this._clanUpdateTimeout);
      this._clanUpdateTimeout = null;
    }
    this.clearLongPress();
  }

  render() {
    return html`
      <div class="border-t border-white/10 pt-6">
        <div class="flex justify-between items-center mb-4">
          <div
            class="text-xs font-bold text-white/40 uppercase tracking-widest"
          >
            ${this.activePlayers.length}
            ${this.activePlayers.length === 1
              ? translateText("host_modal.player")
              : translateText("host_modal.players")}
            <span style="margin: 0 8px;">•</span>
            ${this.effectiveNationCount}
            ${this.effectiveNationCount === 1
              ? translateText("host_modal.nation_player")
              : translateText("host_modal.nation_players")}
          </div>
        </div>
        <div
          class="players-list block rounded-lg border border-white/10 bg-white/5 p-2"
        >
          ${this.gameMode === GameMode.Team
            ? this.renderTeamMode()
            : this.renderFreeForAll()}
        </div>
        ${this.renderSpectators()}
      </div>
    `;
  }

  // Watchers, in their own bubble under the players box — they hold no seat, so
  // mixing them into the lists above would show them as people about to play.
  // Mirrors the players section: the count header sits ABOVE the box (same
  // classes as the "N players" header) and the box reuses .players-list, which
  // is what centers the tags.
  private renderSpectators() {
    const spectators = this.spectators;
    if (spectators.length === 0) return html``;
    return html`
      <div class="mt-4">
        <div
          class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4"
        >
          ${spectators.length}
          ${spectators.length === 1
            ? translateText("host_modal.spectator")
            : translateText("host_modal.spectators")}
        </div>
        <div
          class="players-list block rounded-lg border border-white/10 bg-white/5 p-2"
        >
          ${repeat(
            spectators,
            (c) => c.clientID ?? c.username,
            (client) =>
              html`<span
                class="player-tag ${this.isCurrentPlayer(client)
                  ? "current-player"
                  : ""}"
              >
                <span class="text-white"
                  >${this.getClientDisplayName(client)}
                  ${this.renderVerifiedBadge(client)}</span
                >
              </span>`,
          )}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }

  private renderTeamMode() {
    const active = this.teamPreview.filter(
      (t) => t.players.length > 0 || t.team === ColoredTeams.Nations,
    );
    const empty = this.teamPreview.filter(
      (t) => t.players.length === 0 && t.team !== ColoredTeams.Nations,
    );
    return html`
      <div class="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch">
        <div
          class="w-full md:w-60 bg-gray-800 p-2 border border-gray-700 rounded-lg"
        >
          <div class="font-bold mb-1.5 text-gray-300 text-sm">
            ${translateText("host_modal.players")}
          </div>
          ${repeat(
            this.activePlayers,
            (c) => c.clientID ?? c.username,
            (client) => {
              const displayName = this.getClientDisplayName(client);
              return html`<div
                class="px-2 py-1 rounded-sm mb-1 text-xs text-white border break-words
                ${this.isCurrentPlayer(client)
                  ? "bg-malibu-blue/20 border-sky-500/40"
                  : "bg-gray-700/70 border-transparent"}"
              >
                ${displayName} ${this.renderVerifiedBadge(client)}
                ${this.renderFriendBadge(client)}
              </div>`;
            },
          )}
        </div>
        <div class="flex-1 flex flex-col gap-3 md:gap-4 md:pr-1">
          <div>
            <div class="font-semibold text-gray-200 mb-1 text-sm">
              ${translateText("host_modal.assigned_teams")}
            </div>
            <div class="w-full grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3">
              ${repeat(
                active,
                (p) => p.team,
                (preview) => this.renderTeamCard(preview, false),
              )}
            </div>
          </div>
          <div>
            ${empty.length > 0
              ? html`<div class="font-semibold text-gray-200 mb-1 text-sm">
                  ${translateText("host_modal.empty_teams")}
                </div>`
              : ""}
            <div class="w-full grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3">
              ${repeat(
                empty,
                (p) => p.team,
                (preview) => this.renderTeamCard(preview, true),
              )}
            </div>
          </div>
        </div>
      </div>
      ${this.renderTeamControls()}
    `;
  }

  private renderTeamControls() {
    if (this.teamCount === HumansVsNations) return html``;
    const hostControls = this.onApplyTeamPreset !== undefined;
    if (!hostControls && !this.allowPlayerTeamSelection) return html``;
    return html`
      <div class="mt-3 border-t border-white/10 pt-3 flex flex-col gap-2">
        ${this.onAllowPlayerTeamSelectionChanged
          ? html`<label
              class="flex items-center gap-2 text-xs text-gray-200 cursor-pointer"
            >
              <input
                type="checkbox"
                .checked=${this.allowPlayerTeamSelection}
                ?disabled=${this.teamEditingLocked}
                @change=${(event: Event) =>
                  this.onAllowPlayerTeamSelectionChanged?.(
                    (event.target as HTMLInputElement).checked,
                  )}
              />
              ${translateText("host_modal.allow_player_team_selection")}
            </label>`
          : html`<div class="text-[11px] text-sky-300">
              ${translateText("host_modal.choose_own_team_hint")}
            </div>`}
        ${hostControls
          ? html`<div class="flex flex-wrap gap-2">
              <button
                class="px-3 py-1.5 rounded-md bg-sky-700 hover:bg-sky-600 disabled:opacity-40 text-xs font-semibold text-white"
                ?disabled=${this.teamEditingLocked}
                @click=${() => this.onApplyTeamPreset?.("balanced")}
              >
                ${translateText("host_modal.auto_balance_teams")}
              </button>
              <button
                class="px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-xs font-semibold text-white"
                ?disabled=${this.teamEditingLocked}
                @click=${() => this.onApplyTeamPreset?.("humans_together")}
              >
                ${translateText("host_modal.humans_together")}
              </button>
            </div>`
          : html``}
      </div>
    `;
  }

  // Host-only per-player toggle for who may see real names under anonymizeNames.
  private renderRevealToggle(clientID: string) {
    if (!this.onToggleNameReveal || !this.anonymizeNames) return html``;
    const on = this.nameReveals.includes(clientID);
    return html`<button
      @click=${() => this.onToggleNameReveal?.(clientID)}
      title=${translateText("host_modal.toggle_name_reveal")}
      style="background:none;border:none;cursor:pointer;font-size:13px;line-height:1;margin-left:4px;opacity:${on
        ? "1"
        : "0.35"};"
    >
      👁
    </button>`;
  }

  private renderFreeForAll() {
    return html`${repeat(
      this.activePlayers,
      (c) => c.clientID ?? c.username,
      (client) => {
        const displayName = this.getClientDisplayName(client);
        return html`<span
          class="player-tag ${this.isCurrentPlayer(client)
            ? "current-player"
            : ""}"
        >
          <span class="text-white"
            >${displayName} ${this.renderVerifiedBadge(client)}
            ${this.renderFriendBadge(client)}</span
          >
          ${this.renderRevealToggle(client.clientID)}
          ${client.clientID === this.lobbyCreatorClientID
            ? html`<span class="host-badge"
                >(${translateText("host_modal.host_badge")})</span
              >`
            : this.onKickPlayer
              ? html`<button
                  class="remove-player-btn"
                  @click=${() => this.onKickPlayer?.(client.clientID)}
                  aria-label=${translateText("host_modal.remove_player", {
                    username: displayName,
                  })}
                >
                  <svg
                    class="h-2.5 w-2.5 stroke-white"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                  >
                    <line x1="4" y1="4" x2="12" y2="12" />
                    <line x1="12" y1="4" x2="4" y2="12" />
                  </svg>
                </button>`
              : html``}
        </span>`;
      },
    )} `;
  }

  private renderTeamCard(preview: TeamPreviewData, isEmpty: boolean = false) {
    const teamIndex = this.teamPreview.findIndex(
      (p) => p.team === preview.team,
    );
    const displayCount =
      preview.team === ColoredTeams.Nations
        ? this.effectiveNationCount
        : preview.players.length;

    const maxTeamSize =
      preview.team === ColoredTeams.Nations
        ? this.effectiveNationCount
        : this.teamMaxSize;

    const clanTag = this._teamClanTags.get(preview.team) ?? null;
    const teamLabel = getTranslatedPlayerTeamLabel(preview.team, clanTag);

    return html`
      <div
        data-team-index=${teamIndex}
        @dragover=${(event: DragEvent) => {
          if (this.teamEditingLocked) return;
          event.preventDefault();
          this.dragOverTeamIndex = teamIndex;
        }}
        @dragleave=${() => {
          if (this.dragOverTeamIndex === teamIndex)
            this.dragOverTeamIndex = null;
        }}
        @drop=${(event: DragEvent) => this.dropPlayerOnTeam(event, teamIndex)}
        class="bg-gray-800 border rounded-xl flex flex-col transition-colors
          ${this.dragOverTeamIndex === teamIndex ? "ring-2 ring-sky-400" : ""}
          ${this.teamContainsCurrentPlayer(preview)
          ? "border-sky-500/60"
          : "border-gray-700"}"
      >
        <div
          class="px-2 py-1 font-bold flex items-center justify-between text-white rounded-t-xl text-[13px] gap-2 bg-gray-700/70"
        >
          <div class="flex items-center gap-1.5 min-w-0">
            ${this.showTeamColors
              ? html` <span
                  class="inline-block w-2.5 h-2.5 rounded-full border-2 border-white/90 shadow-inner bg-(--bg) shrink-0"
                  style="--bg:${this.teamHeaderColor(preview.team)};"
                ></span>`
              : null}
            <span class="truncate">${teamLabel}</span>
          </div>
          <span class="text-white/90 font-bold text-[13px] shrink-0"
            >${displayCount}/${maxTeamSize}</span
          >
        </div>
        <div class="p-2 ${isEmpty ? "" : "flex flex-col gap-1.5"}">
          ${isEmpty
            ? html`<div class="text-[11px] italic text-gray-400">
                ${translateText("host_modal.empty_team")}
              </div>`
            : repeat(
                preview.players,
                (p) => p.clientID ?? p.username,
                (p) => {
                  const displayName = this.getClientDisplayName(p);
                  const canControl = this.canControlPlayer(p);
                  return html` <div
                    .draggable=${canControl}
                    @dragstart=${(event: DragEvent) =>
                      this.startPlayerDrag(event, p)}
                    @dragend=${() => this.finishPlayerDrag()}
                    @contextmenu=${(event: MouseEvent) =>
                      this.openTeamMenu(event, p)}
                    @pointerdown=${(event: PointerEvent) =>
                      this.startLongPress(event, p)}
                    @pointermove=${(event: PointerEvent) =>
                      this.moveLongPress(event)}
                    @pointerup=${(event: PointerEvent) =>
                      this.finishLongPress(event)}
                    @pointercancel=${() => this.clearLongPress()}
                    class="relative px-2 py-1 rounded-sm text-xs flex items-center justify-between border
                      ${canControl ? "cursor-grab select-none" : ""}
                      ${this.isCurrentPlayer(p)
                      ? "bg-malibu-blue/20 border-sky-500/40"
                      : "bg-gray-700/70 border-transparent"}"
                  >
                    <span class="flex items-center gap-1 min-w-0">
                      <span class="truncate text-white">${displayName}</span>
                      ${this.renderVerifiedBadge(p)}
                      ${this.renderFriendBadge(p)}
                    </span>
                    ${this.renderRevealToggle(p.clientID)}
                    ${canControl
                      ? html`<button
                          class="ml-1 px-1 text-white/60 hover:text-white"
                          title=${translateText("host_modal.move_player_team")}
                          @click=${(event: MouseEvent) =>
                            this.openTeamMenu(event, p)}
                        >
                          ⋯
                        </button>`
                      : html``}
                    ${p.clientID === this.lobbyCreatorClientID
                      ? html`<span class="ml-2 text-[11px] text-green-300"
                          >(${translateText("host_modal.host_badge")})</span
                        >`
                      : this.onKickPlayer
                        ? html`<button
                            class="remove-player-btn ml-2"
                            @click=${() => this.onKickPlayer?.(p.clientID)}
                            aria-label=${translateText(
                              "host_modal.remove_player",
                              {
                                username: displayName,
                              },
                            )}
                          >
                            <svg
                              class="h-2.5 w-2.5 stroke-white"
                              viewBox="0 0 16 16"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2.5"
                              stroke-linecap="round"
                            >
                              <line x1="4" y1="4" x2="12" y2="12" />
                              <line x1="12" y1="4" x2="4" y2="12" />
                            </svg>
                          </button>`
                        : html``}
                    ${this.teamMenuClientID === p.clientID
                      ? this.renderTeamMenu(p)
                      : html``}
                  </div>`;
                },
              )}
        </div>
      </div>
    `;
  }

  private canControlPlayer(client: ClientInfo): boolean {
    if (
      this.teamCount === HumansVsNations ||
      this.teamEditingLocked ||
      this.onAssignPlayerTeam === undefined
    ) {
      return false;
    }
    return (
      this.canManageAllTeams ||
      (this.allowPlayerTeamSelection && this.isCurrentPlayer(client))
    );
  }

  private openTeamMenu(event: Event, client: ClientInfo) {
    if (!this.canControlPlayer(client)) return;
    event.preventDefault();
    event.stopPropagation();
    this.teamMenuClientID =
      this.teamMenuClientID === client.clientID ? null : client.clientID;
  }

  private renderTeamMenu(client: ClientInfo) {
    return html`<div
      class="absolute right-1 top-full z-30 mt-1 min-w-36 rounded-md border border-white/20 bg-gray-950 p-1 shadow-xl"
    >
      ${this.getTeamList().map(
        (team, teamIndex) =>
          html`<button
            class="block w-full rounded px-2 py-1.5 text-left text-xs text-white hover:bg-white/10"
            @click=${(event: MouseEvent) => {
              event.stopPropagation();
              this.assignPlayer(client.clientID, teamIndex);
            }}
          >
            ${getTranslatedPlayerTeamLabel(
              team,
              this._teamClanTags.get(team) ?? null,
            )}
          </button>`,
      )}
      <button
        class="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-300 hover:bg-white/10"
        @click=${(event: MouseEvent) => {
          event.stopPropagation();
          this.assignPlayer(client.clientID, null);
        }}
      >
        ${translateText("host_modal.automatic_team_assignment")}
      </button>
    </div>`;
  }

  private assignPlayer(clientID: ClientID, teamIndex: number | null) {
    this.teamMenuClientID = null;
    this.dragOverTeamIndex = null;
    this.onAssignPlayerTeam?.(clientID, teamIndex);
  }

  private startPlayerDrag(event: DragEvent, client: ClientInfo) {
    if (!this.canControlPlayer(client)) {
      event.preventDefault();
      return;
    }
    this.draggingClientID = client.clientID;
    event.dataTransfer?.setData("text/plain", client.clientID);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  private dropPlayerOnTeam(event: DragEvent, teamIndex: number) {
    event.preventDefault();
    const clientID =
      this.draggingClientID ?? event.dataTransfer?.getData("text/plain") ?? "";
    const client = this.activePlayers.find((p) => p.clientID === clientID);
    if (client && this.canControlPlayer(client)) {
      this.assignPlayer(client.clientID, teamIndex);
    }
    this.finishPlayerDrag();
  }

  private finishPlayerDrag() {
    this.draggingClientID = null;
    this.dragOverTeamIndex = null;
  }

  private startLongPress(event: PointerEvent, client: ClientInfo) {
    if (event.pointerType === "mouse" || !this.canControlPlayer(client)) return;
    this.clearLongPress();
    this.longPressClientID = client.clientID;
    this.longPressStart = { x: event.clientX, y: event.clientY };
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      this.longPressActive = true;
    }, 350);
  }

  private moveLongPress(event: PointerEvent) {
    if (this.longPressClientID === null) return;
    if (!this.longPressActive) {
      if (
        Math.hypot(
          event.clientX - this.longPressStart.x,
          event.clientY - this.longPressStart.y,
        ) > 8
      ) {
        this.clearLongPress();
      }
      return;
    }
    event.preventDefault();
    this.dragOverTeamIndex = this.teamIndexAtPoint(
      event.clientX,
      event.clientY,
    );
  }

  private finishLongPress(event: PointerEvent) {
    const clientID = this.longPressClientID;
    if (clientID !== null && this.longPressActive) {
      event.preventDefault();
      const teamIndex = this.teamIndexAtPoint(event.clientX, event.clientY);
      const client = this.activePlayers.find((p) => p.clientID === clientID);
      if (teamIndex !== null && client && this.canControlPlayer(client)) {
        this.assignPlayer(clientID, teamIndex);
      }
    }
    this.clearLongPress();
  }

  private teamIndexAtPoint(x: number, y: number): number | null {
    const element = document.elementFromPoint(x, y) as HTMLElement | null;
    const card = element?.closest<HTMLElement>("[data-team-index]");
    if (!card) return null;
    const value = Number(card.dataset.teamIndex);
    return Number.isInteger(value) ? value : null;
  }

  private clearLongPress() {
    if (this.longPressTimer !== null) window.clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    this.longPressClientID = null;
    this.longPressActive = false;
    this.dragOverTeamIndex = null;
  }

  private getTeamList(): Team[] {
    if (this.gameMode !== GameMode.Team) return [];
    const playerCount = this.activePlayers.length + this.effectiveNationCount;
    const config = this.teamCount;

    if (config === HumansVsNations) {
      return [ColoredTeams.Humans, ColoredTeams.Nations];
    }

    let numTeams: number;
    if (typeof config === "number") {
      numTeams = Math.max(2, config);
    } else {
      const divisor =
        config === Duos ? 2 : config === Trios ? 3 : config === Quads ? 4 : 2;
      numTeams = Math.max(2, Math.ceil(playerCount / divisor));
    }

    if (numTeams < 8) {
      const ordered: Team[] = [
        ColoredTeams.Red,
        ColoredTeams.Blue,
        ColoredTeams.Yellow,
        ColoredTeams.Green,
        ColoredTeams.Purple,
        ColoredTeams.Orange,
        ColoredTeams.Teal,
      ];
      return ordered.slice(0, numTeams);
    }

    return Array.from({ length: numTeams }, (_, i) => `Team ${i + 1}`);
  }

  private teamHeaderColor(team: Team): string {
    try {
      return this.theme.teamColor(team).toHex();
    } catch {
      return "#3b3f46"; // Default gray for unknown teams
    }
  }

  private computeTeamPreview(teams: Team[] = []) {
    if (this.gameMode !== GameMode.Team) {
      this.teamPreview = [];
      this.teamMaxSize = 0;
      this._teamClanTags.clear();
      if (this._clanUpdateTimeout !== null) {
        window.clearTimeout(this._clanUpdateTimeout);
        this._clanUpdateTimeout = null;
      }
      return;
    }

    // HumansVsNations: show all clients under Humans initially
    if (this.teamCount === HumansVsNations) {
      this.teamMaxSize = this.activePlayers.length;
      this.teamPreview = [
        { team: ColoredTeams.Humans, players: [...this.activePlayers] },
        { team: ColoredTeams.Nations, players: [] },
      ];
      this.triggerClanUpdate();
      return;
    }

    const players = this.activePlayers.map(
      (c) =>
        new PlayerInfo(
          c.username,
          PlayerType.Human,
          c.clientID,
          c.clientID,
          false,
          c.clanTag,
          c.friends ?? [],
          c.teamIndex ?? null,
        ),
    );
    const assignment = assignTeamsLobbyPreview(
      players,
      teams,
      this.teamCount,
      this.effectiveNationCount,
    );
    const buckets = new Map<Team, ClientInfo[]>();
    for (const t of teams) buckets.set(t, []);

    for (const [p, team] of assignment.entries()) {
      if (team === "kicked") continue;
      const bucket = buckets.get(team);
      if (!bucket) continue;
      const client = this.clients.find((c) => c.clientID === p.clientID);
      if (client) bucket.push(client);
    }

    // Compute per-team capacity safely and align with common team sizes
    if (this.teamCount === Duos) {
      this.teamMaxSize = 2;
    } else if (this.teamCount === Trios) {
      this.teamMaxSize = 3;
    } else if (this.teamCount === Quads) {
      this.teamMaxSize = 4;
    } else {
      // Fallback: divide players across teams; guard against 0 and empty lobbies
      this.teamMaxSize = Math.max(
        1,
        Math.ceil(
          (this.clients.length + this.effectiveNationCount) / teams.length,
        ),
      );
    }
    this.teamPreview = teams.map((t) => ({
      team: t,
      players: buckets.get(t) ?? [],
    }));
    this.triggerClanUpdate();
  }

  private triggerClanUpdate() {
    if (this._teamClanTags.size === 0) {
      this.updateTeamClanTags();
    } else {
      this.scheduleClanUpdate();
    }
  }

  private scheduleClanUpdate() {
    if (this._clanUpdateTimeout !== null) return;
    this._clanUpdateTimeout = window.setTimeout(() => {
      this.updateTeamClanTags();
      this._clanUpdateTimeout = null;
      this.requestUpdate();
    }, 500);
  }

  private updateTeamClanTags() {
    this._teamClanTags.clear();
    for (const preview of this.teamPreview) {
      const tag = resolveTeamClanTag(preview.players);
      this._teamClanTags.set(preview.team, tag);
    }
  }

  private isCurrentPlayer(client: ClientInfo): boolean {
    return !!this.currentClientID && client.clientID === this.currentClientID;
  }

  private teamContainsCurrentPlayer(preview: TeamPreviewData): boolean {
    return preview.players.some((p) => this.isCurrentPlayer(p));
  }

  private getClientDisplayName(client: ClientInfo): string {
    const full = formatPlayerDisplayName(client.username, client.clanTag);
    if (!this.userSettings.anonymousNames()) {
      return full;
    }
    if (this.currentClientID && client.clientID === this.currentClientID) {
      return full;
    }
    // Keep clan tag visible while anonymizing only the username.
    const anonymizedUsername =
      createRandomName(client.username, PlayerType.Human) ?? client.username;
    return formatPlayerDisplayName(anonymizedUsername, client.clanTag);
  }

  // Blue check for players on their server-validated account name. Withheld
  // when this row's name is locally anonymized — the badge vouches for the
  // exact displayed name.
  private renderVerifiedBadge(client: ClientInfo) {
    const anonymized =
      this.userSettings.anonymousNames() && !this.isCurrentPlayer(client);
    if (client.verified !== true || anonymized) return html``;
    return html`<svg
      viewBox="0 0 24 24"
      class="inline-block w-3.5 h-3.5 align-[-2px] text-blue-400 shrink-0"
      aria-label=${translateText("username.verified_heading")}
    >
      <circle cx="12" cy="12" r="10" fill="currentColor"></circle>
      <path
        d="M7.5 12.5l3 3 6-6.5"
        stroke="white"
        stroke-width="2.2"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path>
    </svg>`;
  }

  // A mark for players on the viewer's friends list
  private renderFriendBadge(client: ClientInfo) {
    if (!this._viewerFriends.has(client.clientID)) return html``;
    if (this.isCurrentPlayer(client)) return html``;
    if (this.anonymizeNames || this.userSettings.anonymousNames())
      return html``;
    return html`<svg
      viewBox="0 0 24 24"
      class="lobby-friend-badge inline-block w-4 h-4 align-[-3px] text-emerald-400 shrink-0"
      fill="currentColor"
      aria-label=${translateText("friends.lobby_marker")}
    >
      <title>${translateText("friends.lobby_marker")}</title>
      <circle cx="9" cy="8" r="3.6"></circle>
      <path
        d="M9 13.2c-3.4 0-6.3 1.7-6.3 3.9V20h12.6v-2.9c0-2.2-2.9-3.9-6.3-3.9z"
      ></path>
      <circle cx="17.4" cy="8.6" r="2.9"></circle>
      <path
        d="M17.4 13.4c-.7 0-1.3.06-1.9.18 1.2 1 1.9 2.24 1.9 3.52V20h5.4v-2.6c0-1.9-2.4-4-5.4-4z"
      ></path>
    </svg>`;
  }
}
