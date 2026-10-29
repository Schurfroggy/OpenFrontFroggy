import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/client/GameFeedback";
import { GameFeedback } from "../../src/client/GameFeedback";
import { GameMetrics, feedbackMetrics } from "../../src/client/GameMetrics";
import { FeedbackInputSchema } from "../../src/core/UserFeedback";
vi.mock("../../src/client/Utils", () => ({ translateText: (s: string) => s }));
vi.mock("../../src/client/Telemetry", () => ({ reportMeasurement: vi.fn() }));
const context = {
  map: "China",
  size: "Normal",
  mode: "FFA",
  difficulty: "Medium",
  bots: 400,
  nations: "default",
  fog: false,
  won: false,
  duration: 60,
  version: "test",
};
let card: GameFeedback;
beforeEach(async () => {
  card = document.createElement("game-feedback") as GameFeedback;
  card.gameId = crypto.randomUUID();
  card.context = context;
  document.body.append(card);
  await card.updateComplete;
});
afterEach(() => {
  card.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("game feedback", () => {
  it("freezes diagnostics, excludes them when unchecked, retains failed input, and retries the same id", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "saved" }) });
    vi.stubGlobal("fetch", post);
    const buttons = card.querySelectorAll("button");
    (buttons[1] as HTMLButtonElement).click();
    await card.updateComplete;
    const checkbox = card.querySelector("input")!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    await card.updateComplete;
    const submit = () =>
      Array.from(card.querySelectorAll("button")).slice(-1)[0].click();
    submit();
    await vi.waitFor(() =>
      expect(card.querySelector("[role=alert]")).not.toBeNull(),
    );
    expect(card.querySelector("textarea")).not.toBeNull();
    submit();
    await vi.waitFor(() =>
      expect(card.querySelector("[role=status]")).not.toBeNull(),
    );
    const a = JSON.parse(post.mock.calls[0][1].body),
      b = JSON.parse(post.mock.calls[1][1].body);
    expect(a.diagnostics).toBeUndefined();
    expect(a.submissionId).toBe(b.submissionId);
  });
  it("submits the default diagnostic payload accepted by the server schema", async () => {
    const post = vi
      .fn()
      .mockImplementation(async (_url, options) => ({
        ok: FeedbackInputSchema.safeParse(JSON.parse(options.body)).success,
        json: async () => ({ id: "saved" }),
      }));
    vi.stubGlobal("fetch", post);
    const rating = card.querySelectorAll("button")[1] as HTMLButtonElement;
    rating.click();
    await card.updateComplete;
    const buttons = card.querySelectorAll("button");
    (buttons[buttons.length - 1] as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(card.querySelector("[role=status]")).not.toBeNull(),
    );
    expect(JSON.parse(post.mock.calls[0][1].body).diagnostics).toBeDefined();
  });

  it("retains bounded recent summaries when telemetry windows flush", () => {
    vi.useFakeTimers();
    const metrics = new GameMetrics("recent-test", "client", 30000);
    metrics.start();
    for (let i = 0; i < 15; i++) {
      metrics.recordTickExecution(i);
      vi.advanceTimersByTime(30000);
    }
    metrics.recordReconnect();
    const snapshot = feedbackMetrics("recent-test");
    expect(snapshot.windows.length).toBeLessThanOrEqual(11);
    expect(snapshot.reconnects).toBe(1);
    metrics.recordTickExecution(999);
    expect(
      snapshot.windows[snapshot.windows.length - 1].values.tick_execution_p99,
    ).not.toBe(999);
    metrics.stop();
  });
});
