import { z } from "zod";

/**
 * Browser side of the self-hosted friends API.
 *
 * Mirrors SelfHostedAccount.ts: zod-parse every response, normalise failures to
 * `{ ok: false, error }` so callers never have to think about fetch semantics.
 *
 * Usernames are the only handle that crosses this boundary — the server never
 * returns an account id, which doubles as the play token.
 */

const FriendSchema = z.object({
  username: z.string(),
  since: z.string(),
});

const FriendRequestSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  createdAt: z.string(),
});

const GameInviteSchema = z.object({
  id: z.uuid(),
  gameID: z.string(),
  fromUsername: z.string(),
  createdAt: z.string(),
  expiresAt: z.number(),
});

const FriendsSchema = z.object({
  friends: z.array(FriendSchema),
  incoming: z.array(FriendRequestSchema),
  outgoing: z.array(FriendRequestSchema),
});

const InboxSchema = z.object({
  friendRequests: z.array(FriendRequestSchema),
  invites: z.array(GameInviteSchema),
});

const LookupSchema = z.object({
  username: z.string(),
  relation: z.enum(["self", "friend", "pending_out", "pending_in", "none"]),
});

const InviteResultSchema = z.object({
  invited: z.number(),
  skipped: z.array(
    z.object({
      username: z.string(),
      reason: z.enum(["account_not_found", "self", "not_friend"]),
    }),
  ),
});

export type FriendSummary = z.infer<typeof FriendSchema>;
export type FriendRequest = z.infer<typeof FriendRequestSchema>;
export type GameInvite = z.infer<typeof GameInviteSchema>;
export type FriendsOverview = z.infer<typeof FriendsSchema>;
export type FriendsInbox = z.infer<typeof InboxSchema>;
export type FriendRelation = z.infer<typeof LookupSchema>["relation"];
export type FriendLookup = z.infer<typeof LookupSchema>;
export type InviteResult = z.infer<typeof InviteResultSchema>;

export type FriendsResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function request<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<FriendsResult<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      return { ok: false, error: body.error ?? `http_${response.status}` };
    }
    if (response.status === 204) {
      return { ok: true, data: undefined as T };
    }
    const parsed = schema.safeParse(await response.json());
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, error: "invalid_response" };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}

const noContent = z.undefined();

export function loadFriends(): Promise<FriendsResult<FriendsOverview>> {
  return request("/api/self-hosted/friends", FriendsSchema);
}

export function lookupFriend(
  username: string,
): Promise<FriendsResult<FriendLookup>> {
  return request(
    `/api/self-hosted/friends/lookup?username=${encodeURIComponent(username)}`,
    LookupSchema,
  );
}

export function sendFriendRequest(
  username: string,
): Promise<FriendsResult<{ status: string }>> {
  return request(
    "/api/self-hosted/friends/requests",
    z.object({ id: z.uuid(), status: z.string() }),
    {
      method: "POST",
      body: JSON.stringify({ username }),
    },
  );
}

export function acceptFriendRequest(id: string): Promise<FriendsResult<void>> {
  return request(
    `/api/self-hosted/friends/requests/${encodeURIComponent(id)}/accept`,
    noContent,
    { method: "POST" },
  );
}

export function declineFriendRequest(id: string): Promise<FriendsResult<void>> {
  return request(
    `/api/self-hosted/friends/requests/${encodeURIComponent(id)}/decline`,
    noContent,
    { method: "POST" },
  );
}

export function removeFriend(username: string): Promise<FriendsResult<void>> {
  return request(
    `/api/self-hosted/friends/${encodeURIComponent(username)}`,
    noContent,
    { method: "DELETE" },
  );
}

export function loadInbox(): Promise<FriendsResult<FriendsInbox>> {
  return request("/api/self-hosted/inbox", InboxSchema);
}

export function loadGameInvites(
  gameID: string,
): Promise<FriendsResult<{ invited: string[] }>> {
  return request(
    `/api/self-hosted/invites?gameID=${encodeURIComponent(gameID)}`,
    z.object({ invited: z.array(z.string()) }),
  );
}

export function sendGameInvites(
  gameID: string,
  to: string[],
): Promise<FriendsResult<InviteResult>> {
  return request("/api/self-hosted/invites", InviteResultSchema, {
    method: "POST",
    body: JSON.stringify({ gameID, to }),
  });
}

export function setGameInviteStatus(
  id: string,
  action: "accept" | "dismiss",
): Promise<FriendsResult<void>> {
  return request(
    `/api/self-hosted/invites/${encodeURIComponent(id)}/${action}`,
    noContent,
    { method: "POST" },
  );
}
