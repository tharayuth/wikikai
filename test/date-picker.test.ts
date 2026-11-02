import { describe, expect, it, vi } from "vitest";
import { openDatePicker } from "../client/src/lib/datePicker.js";

describe("openDatePicker", () => {
  it("opens the browser's calendar", () => {
    const showPicker = vi.fn();
    openDatePicker({ showPicker, disabled: false, readOnly: false });
    expect(showPicker).toHaveBeenCalledOnce();
  });

  it("leaves a disabled or read-only field alone", () => {
    const showPicker = vi.fn();
    openDatePicker({ showPicker, disabled: true, readOnly: false });
    openDatePicker({ showPicker, disabled: false, readOnly: true });
    expect(showPicker).not.toHaveBeenCalled();
  });

  it("does nothing on a browser without showPicker", () => {
    expect(() => openDatePicker({ disabled: false, readOnly: false })).not.toThrow();
  });

  it("does not throw when the browser refuses, because typing the date still works", () => {
    const showPicker = vi.fn(() => {
      throw new DOMException("not allowed", "NotAllowedError");
    });
    expect(() => openDatePicker({ showPicker, disabled: false, readOnly: false })).not.toThrow();
  });
});
