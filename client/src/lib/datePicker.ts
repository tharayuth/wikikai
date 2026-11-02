/**
 * Open the browser's calendar when a date field is clicked anywhere, not only on
 * its small icon. Older browsers have no `showPicker` and a browser may refuse it;
 * the date can still be typed in either case, so neither is an error.
 */
export function openDatePicker(input: { showPicker?: () => void; disabled: boolean; readOnly: boolean }): void {
  if (input.disabled || input.readOnly) return;
  try {
    input.showPicker?.();
  } catch {
    // Typing still works.
  }
}
