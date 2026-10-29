import { describe, expect, it, vi } from "vitest";
import { registerUserFeedbackRoutes } from "../../src/server/UserFeedbackRoutes";
function setup(auth: "none" | "player" | "admin", enabled = true) {
  const routes = new Map<string, (req: any, res: any) => unknown>();
  const app = Object.fromEntries(
    ["get", "post", "patch"].map((method) => [
      method,
      (path: string, ...handlers: ((req: any, res: any) => unknown)[]) =>
        routes.set(method + " " + path, handlers[handlers.length - 1]),
    ]),
  ) as any;
  const store = {
    submit: vi.fn(() => "feedback-id"),
    list: vi.fn(() => ({ items: [], total: 0 })),
    review: vi.fn(() => true),
  };
  registerUserFeedbackRoutes(app, {
    enabled: () => enabled,
    account: () =>
      auth === "none" ? null : { id: "account", username: "Alice" },
    admin: (_req, res) => {
      if (auth === "admin") return { id: "admin" };
      res.status(403).json({ error: "forbidden" });
      return null;
    },
    store: () => store as any,
  });
  const res: any = {
    code: 200,
    status(c: number) {
      this.code = c;
      return this;
    },
    sendStatus(c: number) {
      this.code = c;
      return this;
    },
    json: vi.fn(),
    setHeader: vi.fn(),
  };
  return { routes, store, res };
}
describe("feedback authorization routes", () => {
  it.each(["none", "player"] as const)("denies admin access to %s", (role) => {
    const { routes, store, res } = setup(role);
    routes.get("get /api/self-hosted/admin/feedback")!({ query: {} }, res);
    expect(res.code).toBe(403);
    expect(store.list).not.toHaveBeenCalled();
    routes.get("patch /api/self-hosted/admin/feedback/:id")!(
      { params: { id: "test" }, body: {} },
      res,
    );
    expect(store.review).not.toHaveBeenCalled();
  });
  it("rejects anonymous submissions", () => {
    const { routes, store, res } = setup("none");
    routes.get("post /api/self-hosted/feedback")!({ body: {} }, res);
    expect(res.code).toBe(401);
    expect(store.submit).not.toHaveBeenCalled();
  });
  it("allows paginated admin reads with cache disabled and rejects invalid input", () => {
    const { routes, store, res } = setup("admin");
    const read = routes.get("get /api/self-hosted/admin/feedback")!;
    read({ query: { page: "2", status: "pending", q: "China" } }, res);
    expect(store.list).toHaveBeenCalledWith(2, "pending", "China");
    expect(res.setHeader).toHaveBeenCalled();
    read({ query: { page: "-1" } }, res);
    expect(res.code).toBe(400);
  });
  it("does not expose the feature in non-self-hosted deployments", () => {
    const { routes, store, res } = setup("admin", false);
    routes.get("get /api/self-hosted/admin/feedback")!({ query: {} }, res);
    expect(res.code).toBe(404);
    expect(store.list).not.toHaveBeenCalled();
  });
});
