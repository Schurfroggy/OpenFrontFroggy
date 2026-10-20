import { loadSelfHostedAccount } from "./SelfHostedAccount";
import { loadInbox, type FriendsInbox } from "./SelfHostedFriends";

/**
 * The one inbox poller for the page.
 *
 * The self-hosted server has no push channel for a player (the game socket
 * belongs to a worker and only exists inside a match), and the friends feature
 * needs to reach a player who is sitting in the lobby, browsing, or already in
 * a game. Polling is the honest fit: one request per signed-in client per
 * interval, and every piece of state it reports is already persisted
 * server-side, so a missed tick costs nothing.
 *
 * Changing the signature only on real changes keeps subscribers (nav badge,
 * banner, open friends page) from re-rendering on every empty tick.
 */

const POLL_INTERVAL_MS = 10_000;

/** Fired when the inbox contents change, with the new inbox as `detail`. */
export const FRIENDS_INBOX_EVENT = "selfHostedInbox";

let timer: number | null = null;
let inbox: FriendsInbox | null = null;
let signature = "";
let inFlight = false;

export function currentInbox(): FriendsInbox | null {
  return inbox;
}

export function startFriendsPolling(): void {
  if (timer !== null) return;
  timer = window.setInterval(() => void pollFriendsInbox(), POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  void pollFriendsInbox();
}

export function stopFriendsPolling(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  document.removeEventListener("visibilitychange", handleVisibilityChange);
}

/** Poll now — after an action that changes the inbox (accept/dismiss/invite). */
export async function pollFriendsInbox(): Promise<FriendsInbox | null> {
  if (inFlight) return inbox;
  inFlight = true;
  try {
    const account = await loadSelfHostedAccount();
    if (account === null) {
      publish(null);
      return null;
    }
    const result = await loadInbox();
    if (!result.ok) {
      // A 401 here means the session went away; the next account poll will
      // settle it. Anything else is transient (offline, server restart).
      return inbox;
    }
    publish(result.data);
    return result.data;
  } finally {
    inFlight = false;
  }
}

function publish(next: FriendsInbox | null): void {
  const nextSignature =
    next === null
      ? ""
      : `${next.invites.map((i) => i.id).join(",")}|${next.friendRequests
          .map((r) => r.id)
          .join(",")}`;
  const changed = nextSignature !== signature;
  inbox = next;
  signature = nextSignature;
  if (!changed) return;
  window.dispatchEvent(
    new CustomEvent<FriendsInbox | null>(FRIENDS_INBOX_EVENT, {
      detail: next,
    }),
  );
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "visible") void pollFriendsInbox();
}
