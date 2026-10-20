import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import { FRIENDS_INBOX_EVENT, pollFriendsInbox } from "./FriendsPolling";
import { loadSelfHostedAccount } from "./SelfHostedAccount";
import {
  acceptFriendRequest,
  declineFriendRequest,
  loadFriends,
  loadInbox,
  lookupFriend,
  removeFriend,
  sendFriendRequest,
  setGameInviteStatus,
  type FriendLookup,
  type FriendRequest,
  type FriendsInbox,
  type FriendsOverview,
  type GameInvite,
} from "./SelfHostedFriends";
import { showToast, translateText } from "./Utils";

type FriendsTab = "friends" | "requests" | "invites";

const TAB_CLASS = (active: boolean) =>
  `rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest transition-colors ${
    active
      ? "bg-malibu-blue text-zinc-900"
      : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
  }`;

/**
 * The 好友 page: the friend list, pending requests in both directions, and the
 * game invites waiting for this player.
 *
 * Registered players only — the nav item refuses to navigate for a guest, and
 * this modal repeats that guard for a session that expired under it.
 */
@customElement("friends-modal")
export class FriendsModal extends BaseModal {
  @state() private overview: FriendsOverview | null = null;
  @state() private inbox: FriendsInbox | null = null;
  @state() private tab: FriendsTab = "friends";
  @state() private loading = true;
  @state() private guest = false;
  @state() private error = "";
  @state() private query = "";
  @state() private lookup: FriendLookup | null = null;
  @state() private lookupError = "";
  @state() private busy = false;

  protected onOpen(): void {
    this.error = "";
    this.lookup = null;
    this.lookupError = "";
    this.loading = true;
    window.addEventListener(FRIENDS_INBOX_EVENT, this.onInbox);
    void this.refresh();
  }

  protected onClose(): void {
    window.removeEventListener(FRIENDS_INBOX_EVENT, this.onInbox);
  }

  private onInbox = (event: Event) => {
    const detail = (event as CustomEvent<FriendsInbox | null>).detail;
    if (detail !== null) this.inbox = detail;
  };

  private async refresh(): Promise<void> {
    const account = await loadSelfHostedAccount(true);
    if (account === null) {
      this.guest = true;
      this.loading = false;
      return;
    }
    this.guest = false;
    const [overview, inbox] = await Promise.all([loadFriends(), loadInbox()]);
    if (!overview.ok) {
      this.error = overview.error;
      this.loading = false;
      return;
    }
    this.overview = overview.data;
    if (inbox.ok) this.inbox = inbox.data;
    this.error = "";
    this.loading = false;
  }

  private async run(action: () => Promise<{ ok: boolean; error?: string }>) {
    this.busy = true;
    try {
      const result = await action();
      if (!result.ok) {
        showToast(this.errorText(result.error), "red");
        return false;
      }
      await this.refresh();
      void pollFriendsInbox();
      return true;
    } finally {
      this.busy = false;
    }
  }

  private errorText(code: string | undefined): string {
    switch (code) {
      case "account_not_found":
        return translateText("friends.error_not_found");
      case "self":
        return translateText("friends.cannot_friend_self");
      case "already_friends":
        return translateText("friends.error_conflict");
      case "rate_limited":
        return translateText("friends.error_rate_limited");
      case "friend_limit":
        return translateText("friends.error_friend_limit");
      case "guest":
        return translateText("friends.guest");
      default:
        return translateText("friends.error_generic");
    }
  }

  private async search(): Promise<void> {
    const username = this.query.trim();
    if (username.length === 0) return;
    this.busy = true;
    try {
      const result = await lookupFriend(username);
      this.lookup = result.ok ? result.data : null;
      this.lookupError = result.ok ? "" : this.errorText(result.error);
    } finally {
      this.busy = false;
    }
  }

  private async addFriend(username: string): Promise<void> {
    const ok = await this.run(() => sendFriendRequest(username));
    if (!ok) return;
    showToast(translateText("friends.request_sent"), "green");
    this.query = "";
    await this.searchAgain(username);
  }

  private async searchAgain(username: string): Promise<void> {
    const result = await lookupFriend(username);
    if (result.ok) this.lookup = result.data;
  }

  private async enterGame(invite: GameInvite): Promise<void> {
    void setGameInviteStatus(invite.id, "accept");
    window.dispatchEvent(
      new CustomEvent("selfHostedGameInvite", {
        detail: { gameID: invite.gameID },
      }),
    );
    this.close();
  }

  private async dismissInvite(invite: GameInvite): Promise<void> {
    this.inbox = {
      friendRequests: this.inbox?.friendRequests ?? [],
      invites: (this.inbox?.invites ?? []).filter((i) => i.id !== invite.id),
    };
    await setGameInviteStatus(invite.id, "dismiss");
    void pollFriendsInbox();
  }

  protected renderBody() {
    return html`
      <div class="min-h-full bg-surface px-4 py-8 text-white sm:px-8">
        <div class="mx-auto max-w-3xl">
          ${this.renderHeader()} ${this.loading
            ? html`<div class="rounded-2xl bg-white/5 p-8 text-white/60">
                ${translateText("common.loading")}
              </div>`
            : this.guest
              ? html`<div
                  class="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-6 text-amber-100"
                >
                  ${translateText("friends.guest")}
                </div>`
              : html`${this.renderTabs()} ${this.renderTabContent()}`}
        </div>
      </div>
    `;
  }

  private renderHeader() {
    return html`
      <div class="mb-6 flex items-center justify-between gap-4">
        <h1 class="text-3xl font-black">${translateText("friends.title")}</h1>
        <div class="flex gap-2">
          <button
            class="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            ?disabled=${this.busy}
            @click=${() => void this.refresh()}
          >
            ${translateText("friends.refresh")}
          </button>
          <button
            class="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/10"
            @click=${() => this.close()}
          >
            ${translateText("common.back")}
          </button>
        </div>
      </div>
      ${this.error
        ? html`<div
            class="mb-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100"
          >
            ${this.errorText(this.error)}
          </div>`
        : nothing}
    `;
  }

  private renderTabs() {
    const friends = this.overview?.friends.length ?? 0;
    const requests = this.overview?.incoming.length ?? 0;
    const invites = this.inbox?.invites.length ?? 0;
    const tab = (key: FriendsTab, label: string, count: number) => html`
      <button
        class=${TAB_CLASS(this.tab === key)}
        @click=${() => (this.tab = key)}
      >
        ${label}${count > 0 ? html` (${count})` : nothing}
      </button>
    `;
    return html`
      <div class="mb-6 flex flex-wrap gap-2">
        ${tab("friends", translateText("friends.tab_friends"), friends)}
        ${tab("requests", translateText("friends.tab_requests"), requests)}
        ${tab("invites", translateText("friends.tab_invites"), invites)}
      </div>
    `;
  }

  private renderTabContent() {
    switch (this.tab) {
      case "requests":
        return this.renderRequests();
      case "invites":
        return this.renderInvites();
      default:
        return this.renderFriends();
    }
  }

  private renderFriends() {
    const friends = this.overview?.friends ?? [];
    const outgoing = this.overview?.outgoing ?? [];
    return html`
      <section class="mb-6 rounded-2xl bg-white/5 p-4">
        <div class="mb-2 text-xs font-bold uppercase tracking-widest text-white/60">
          ${translateText("friends.add_friend")}
        </div>
        <div class="flex flex-wrap gap-2">
          <input
            class="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-malibu-blue"
            .value=${this.query}
            placeholder=${translateText("friends.add_placeholder")}
            maxlength="20"
            @input=${(e: Event) => {
              this.query = (e.target as HTMLInputElement).value;
              this.lookup = null;
              this.lookupError = "";
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") void this.search();
            }}
          />
          <button
            class="rounded-lg bg-malibu-blue px-4 py-2 text-sm font-bold text-zinc-900 disabled:opacity-50"
            ?disabled=${this.busy || this.query.trim().length === 0}
            @click=${() => void this.search()}
          >
            ${translateText("friends.search")}
          </button>
        </div>
        ${this.lookupError
          ? html`<div class="mt-2 text-sm text-red-300">${this.lookupError}</div>`
          : nothing}
        ${this.lookup ? this.renderLookup(this.lookup) : nothing}
      </section>

      <section class="rounded-2xl bg-white/5 p-4">
        ${friends.length === 0
          ? html`<div class="p-4 text-center text-white/60">
              ${translateText("friends.no_friends")}
            </div>`
          : html`<ul class="divide-y divide-white/5">
              ${friends.map(
                (friend) => html`
                  <li class="flex items-center justify-between gap-3 py-3">
                    <div class="min-w-0">
                      <div class="truncate font-bold">${friend.username}</div>
                      <div class="text-xs text-white/50">
                        ${translateText("friends.friends_since", {
                          date: formatDate(friend.since),
                        })}
                      </div>
                    </div>
                    <button
                      class="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs text-red-200 hover:bg-red-400/10 disabled:opacity-50"
                      ?disabled=${this.busy}
                      @click=${() => void this.confirmRemove(friend.username)}
                    >
                      ${translateText("friends.remove")}
                    </button>
                  </li>
                `,
              )}
            </ul>`}
      </section>

      ${outgoing.length > 0
        ? html`<section class="mt-6 rounded-2xl bg-white/5 p-4">
            <div class="mb-2 text-xs font-bold uppercase tracking-widest text-white/60">
              ${translateText("friends.outgoing")}
            </div>
            <ul class="divide-y divide-white/5">
              ${outgoing.map(
                (request) => html`
                  <li class="flex items-center justify-between py-2 text-sm">
                    <span class="truncate">${request.username}</span>
                    <span class="text-xs text-white/50"
                      >${translateText("friends.pending")}</span
                    >
                  </li>
                `,
              )}
            </ul>
          </section>`
        : nothing}
    `;
  }

  private renderLookup(lookup: FriendLookup) {
    const button = (label: string, onClick: () => void, enabled = true) => html`
      <button
        class="rounded-lg bg-malibu-blue px-4 py-2 text-sm font-bold text-zinc-900 disabled:opacity-50"
        ?disabled=${this.busy || !enabled}
        @click=${onClick}
      >
        ${label}
      </button>
    `;
    switch (lookup.relation) {
      case "none":
        return html`
          <div class="mt-3 flex items-center justify-between gap-3 rounded-xl bg-black/20 p-3">
            <span class="truncate font-bold">${lookup.username}</span>
            ${button(
              translateText("friends.send_request"),
              () => void this.addFriend(lookup.username),
            )}
          </div>
        `;
      case "pending_in":
        return html`
          <div class="mt-3 flex items-center justify-between gap-3 rounded-xl bg-black/20 p-3">
            <span class="truncate font-bold">${lookup.username}</span>
            ${button(translateText("friends.accept"), () => void this.acceptByUsername(lookup.username))}
          </div>
        `;
      case "pending_out":
        return html`<div class="mt-3 rounded-xl bg-black/20 p-3 text-sm text-white/60">
          ${lookup.username} · ${translateText("friends.relation_pending_out")}
        </div>`;
      case "friend":
        return html`<div class="mt-3 rounded-xl bg-black/20 p-3 text-sm text-white/60">
          ${lookup.username} · ${translateText("friends.relation_friend")}
        </div>`;
      case "self":
        return html`<div class="mt-3 rounded-xl bg-black/20 p-3 text-sm text-white/60">
          ${translateText("friends.cannot_friend_self")}
        </div>`;
    }
  }

  private async acceptByUsername(username: string): Promise<void> {
    const request = this.overview?.incoming.find(
      (r) => r.username.toLowerCase() === username.toLowerCase(),
    );
    if (request === undefined) return;
    const ok = await this.run(() => acceptFriendRequest(request.id));
    if (ok) showToast(translateText("friends.request_accepted"), "green");
  }

  private async confirmRemove(username: string): Promise<void> {
    if (!window.confirm(translateText("friends.confirm_remove", { publicId: username }))) {
      return;
    }
    await this.run(() => removeFriend(username));
  }

  private renderRequests() {
    const incoming = this.overview?.incoming ?? [];
    if (incoming.length === 0) {
      return html`<div class="rounded-2xl bg-white/5 p-8 text-center text-white/60">
        ${translateText("friends.empty_requests")}
      </div>`;
    }
    return html`<ul class="divide-y divide-white/5 rounded-2xl bg-white/5 p-4">
      ${incoming.map(
        (request: FriendRequest) => html`
          <li class="flex items-center justify-between gap-3 py-3">
            <span class="min-w-0 truncate font-bold">${request.username}</span>
            <div class="flex shrink-0 gap-2">
              <button
                class="rounded-lg bg-malibu-blue px-3 py-1.5 text-xs font-bold text-zinc-900 disabled:opacity-50"
                ?disabled=${this.busy}
                @click=${() =>
                  void this.run(() => acceptFriendRequest(request.id))}
              >
                ${translateText("friends.accept")}
              </button>
              <button
                class="rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-50"
                ?disabled=${this.busy}
                @click=${() =>
                  void this.run(() => declineFriendRequest(request.id))}
              >
                ${translateText("friends.deny")}
              </button>
            </div>
          </li>
        `,
      )}
    </ul>`;
  }

  private renderInvites() {
    const invites = this.inbox?.invites ?? [];
    if (invites.length === 0) {
      return html`<div class="rounded-2xl bg-white/5 p-8 text-center text-white/60">
        ${translateText("friends.empty_invites")}
      </div>`;
    }
    return html`<ul class="divide-y divide-white/5 rounded-2xl bg-white/5 p-4">
      ${invites.map(
        (invite) => html`
          <li class="flex items-center justify-between gap-3 py-3">
            <div class="min-w-0">
              <div class="truncate font-bold">
                ${translateText("friends.invite_from", {
                  name: invite.fromUsername,
                })}
              </div>
              <div class="text-xs text-white/50">
                ${formatDate(invite.createdAt)}
              </div>
            </div>
            <div class="flex shrink-0 gap-2">
              <button
                class="rounded-lg bg-malibu-blue px-3 py-1.5 text-xs font-bold text-zinc-900"
                @click=${() => void this.enterGame(invite)}
              >
                ${translateText("friends.enter_game")}
              </button>
              <button
                class="rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10"
                @click=${() => void this.dismissInvite(invite)}
              >
                ${translateText("friends.dismiss")}
              </button>
            </div>
          </li>
        `,
      )}
    </ul>`;
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}
