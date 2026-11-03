import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeAll, describe, expect, it, vi } from "vitest";
import TouchNotice from "./TouchNotice.svelte";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

describe("TouchNotice", () => {
  it("explains the app needs a keyboard and can be dismissed", async () => {
    const onClose = vi.fn();
    render(TouchNotice, { props: { onClose } });
    expect(screen.getByText(/Jot Deck is keyboard-driven/)).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Continue anyway" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps keystrokes from reaching the board", async () => {
    render(TouchNotice, { props: { onClose: vi.fn() } });
    const bubbled = vi.fn();
    document.body.addEventListener("keydown", bubbled);
    await fireEvent.keyDown(screen.getByRole("dialog"), { key: "j" });
    document.body.removeEventListener("keydown", bubbled);
    expect(bubbled).not.toHaveBeenCalled();
  });
});
