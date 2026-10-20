import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadFriends: vi.fn(),
  loadInbox: vi.fn(),
  lookupFriend: vi.fn(),
  sendFriendRequest: vi.fn(),
  acceptFriendRequest: vi.fn(),
  declineFriendRequest: vi.fn(),
  removeFriend: vi.fn(),
  sendGameInvites: vi.fn(),
  loadGameInvites: vi.fn(),
  setGameInviteStatus: vi.fn(),
  loadSelfHostedAccount: vi.fn(),
  showToast: vi.fn(),
  pollFriendsInbox: vi.fn(),
}));

vi.mock("../../src/client/SelfHostedFriends", () => ({
  loadFriends: mocks.loadFriends,
  loadInbox: mocks.loadInbox,
  lookupFriend: mocks.lookupFriend,
  sendFriendRequest: mocks.sendFriendRequest,
  acceptFriendRequest: mocks.acceptFriendRequest,
  declineFriendRequest: mocks.declineFriendRequest,
  removeFriend: mocks.removeFriend,
  sendGameInvites: mocks.sendGameInvites,
  loadGameInvites: mocks.loadGameInvites,
  setGameInviteStatus: mocks.setGameInviteStatus,
}));

vi.mock("../../src/client/SelfHostedAccount", () => ({
  loadSelfHostedAccount: mocks.loadSelfHostedAccount,
}));

vi.mock("../../src/client/FriendsPolling", () => ({
  FRIENDS_INBOX_EVENT: "selfHostedInbox",
  currentInbox: () => null,
  pollFriendsInbox: mocks.pollFriendsInbox,
  startFriendsPolling: vi.fn(),
  stopFriendsPolling: vi.fn(),
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params === undefined ? key : `${key}:${JSON.stringify(params)}`,
  showToast: mocks.showToast,
}));

import "../../src/client/FriendsModal";
import type { FriendsModal } from "../../src/client/FriendsModal";
import "../../src/client/components/FriendInviteButton";
import type { FriendInviteButton } from "../../src/client/components/FriendInviteButton";

const ACCOUNT = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "Alice",
  role: "player" as const,
  createdAt: "2026-10-20T00:00:00Z",
};

function friendsOverview(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      friends: [{ username: "Bob", since: "2026-10-19T00:00:00Z" }],
      incoming: [],
      outgoing: [],
      ...overrides,
    },
  };
}

function emptyInbox() {
  return { ok: true, data: { friendRequests: [], invites: [] } };
}

function buttonByText(root: Element, text: string) {
  return Array.from(root.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

let modals: FriendsModal[] = [];
let buttons: FriendInviteButton[] = [];

beforeEach(() => {
  mocks.loadSelfHostedAccount.mockResolvedValue(ACCOUNT);
  mocks.loadFriends.mockResolvedValue(friendsOverview());
  mocks.loadInbox.mockResolvedValue(emptyInbox());
  mocks.loadGameInvites.mockResolvedValue({ ok: true, data: { invited: [] } });
  mocks.sendFriendRequest.mockResolvedValue({ ok: true, data: {} });
  mocks.sendGameInvites.mockResolvedValue({
    ok: true,
    data: { invited: 1, skipped: [] },
  });
  window.showPage = vi.fn() as unknown as typeof window.showPage;
});

afterEach(() => {
  modals.forEach((modal) => modal.remove());
  buttons.forEach((button) => button.remove());
  modals = [];
  buttons = [];
  vi.clearAllMocks();
});

async function openFriendsModal(): Promise<FriendsModal> {
  const modal = document.createElement("friends-modal") as FriendsModal;
  modal.inline = true;
  document.body.appendChild(modal);
  modal.open();
  await modal.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await modal.updateComplete;
  modals.push(modal);
  return modal;
}

describe("friends-modal", () => {
  it("lists friends and turns a username lookup into a sent request", async () => {
    mocks.lookupFriend.mockResolvedValue({
      ok: true,
      data: { username: "Carol", relation: "none" },
    });
    const modal = await openFriendsModal();

    expect(modal.textContent).toContain("friends.tab_friends");
    expect(modal.textContent).toContain("Bob");

    const input = modal.querySelector("input") as HTMLInputElement;
    input.value = "Carol";
    input.dispatchEvent(new Event("input"));
    await modal.updateComplete;

    buttonByText(modal, "friends.search")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await modal.updateComplete;

    expect(mocks.lookupFriend).toHaveBeenCalledWith("Carol");
    expect(modal.textContent).toContain("friends.send_request");

    buttonByText(modal, "friends.send_request")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await modal.updateComplete;

    expect(mocks.sendFriendRequest).toHaveBeenCalledWith("Carol");
    expect(mocks.showToast).toHaveBeenCalledWith("friends.request_sent", "green");
  });

  it("tells a guest to sign in instead of showing the lists", async () => {
    mocks.loadSelfHostedAccount.mockResolvedValue(null);
    const modal = await openFriendsModal();

    expect(modal.textContent).toContain("friends.guest");
    expect(mocks.loadFriends).not.toHaveBeenCalled();
  });

  it("shows pending invitations and enters the lobby they name", async () => {
    mocks.loadInbox.mockResolvedValue({
      ok: true,
      data: {
        friendRequests: [],
        invites: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            gameID: "gameABCDE",
            fromUsername: "Bob",
            createdAt: "2026-10-20T00:00:00Z",
            expiresAt: Math.floor(Date.now() / 1000) + 600,
          },
        ],
      },
    });
    const entered: string[] = [];
    window.addEventListener("selfHostedGameInvite", (event) => {
      entered.push((event as CustomEvent<{ gameID: string }>).detail.gameID);
    });

    const modal = await openFriendsModal();
    buttonByText(modal, "friends.tab_invites (1)")?.click();
    await modal.updateComplete;

    expect(modal.textContent).toContain("friends.invite_from");
    buttonByText(modal, "friends.enter_game")?.click();

    expect(entered).toEqual(["gameABCDE"]);
    expect(mocks.setGameInviteStatus).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "accept",
    );
  });
});

describe("friend-invite-button", () => {
  async function openPanel(): Promise<FriendInviteButton> {
    const button = document.createElement(
      "friend-invite-button",
    ) as FriendInviteButton;
    button.gameID = "gameABCDE";
    document.body.appendChild(button);
    await button.updateComplete;
    (button.querySelector("[data-test-invite-friends-list]") as HTMLElement)
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await button.updateComplete;
    buttons.push(button);
    return button;
  }

  it("invites a friend into the current lobby", async () => {
    const button = await openPanel();

    expect(mocks.loadFriends).toHaveBeenCalled();
    expect(button.textContent).toContain("Bob");

    buttonByText(button, "friends.invite")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await button.updateComplete;

    expect(mocks.sendGameInvites).toHaveBeenCalledWith("gameABCDE", ["Bob"]);
    expect(button.textContent).toContain("friends.invited");
  });

  it("asks a guest to sign in before listing anyone", async () => {
    mocks.loadSelfHostedAccount.mockResolvedValue(null);
    const button = await openPanel();

    expect(button.textContent).toContain("friends.guest");
    expect(mocks.loadFriends).not.toHaveBeenCalled();
  });
});
