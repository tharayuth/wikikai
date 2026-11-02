import { describe, expect, it, vi } from "vitest";
import { backdropPress } from "../client/src/lib/backdropPress.js";

describe("backdropPress", () => {
  const backdrop = {};
  const inner = {};
  const onBackdrop = { target: backdrop, currentTarget: backdrop };
  const insideDialog = { target: inner, currentTarget: backdrop };

  it("closes on a press and release on the backdrop", () => {
    const close = vi.fn();
    const press = backdropPress(close);
    press.onMouseDown(onBackdrop);
    press.onMouseUp(onBackdrop);
    expect(close).toHaveBeenCalledOnce();
  });

  it("stays open when selecting text drags out of the dialog", () => {
    const close = vi.fn();
    const press = backdropPress(close);
    press.onMouseDown(insideDialog);
    press.onMouseUp(onBackdrop);
    expect(close).not.toHaveBeenCalled();
  });

  it("stays open when a press on the backdrop ends inside the dialog", () => {
    const close = vi.fn();
    const press = backdropPress(close);
    press.onMouseDown(onBackdrop);
    press.onMouseUp(insideDialog);
    expect(close).not.toHaveBeenCalled();
  });

  it("stays open for a click inside the dialog", () => {
    const close = vi.fn();
    const press = backdropPress(close);
    press.onMouseDown(insideDialog);
    press.onMouseUp(insideDialog);
    expect(close).not.toHaveBeenCalled();
  });

  it("does not carry a press over to the next one", () => {
    const close = vi.fn();
    const press = backdropPress(close);
    press.onMouseDown(onBackdrop);
    press.onMouseUp(insideDialog);
    press.onMouseUp(onBackdrop);
    expect(close).not.toHaveBeenCalled();
    press.onMouseDown(insideDialog);
    press.onMouseUp(onBackdrop);
    press.onMouseDown(onBackdrop);
    press.onMouseUp(onBackdrop);
    expect(close).toHaveBeenCalledOnce();
  });
});
