import { afterEach, describe, expect, it, vi } from "vitest";
import { OButton } from "../../../src/client/components/baseComponents/Button";

describe("OButton", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("runs its action from the internal native button", async () => {
    const action = vi.fn();
    const button = new OButton();
    button.clickHandler = action;
    document.body.append(button);
    await button.updateComplete;

    button.querySelector("button")?.click();

    expect(action).toHaveBeenCalledOnce();
  });

  it("does not run its action while disabled", async () => {
    const action = vi.fn();
    const button = new OButton();
    button.clickHandler = action;
    button.disable = true;
    document.body.append(button);
    await button.updateComplete;

    button.querySelector("button")?.click();

    expect(action).not.toHaveBeenCalled();
  });
});
