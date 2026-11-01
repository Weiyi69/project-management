const focusableSelector =
  "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function trapFocusWithin(event: KeyboardEvent, container: HTMLElement | null): void {
  if (event.key !== "Tab") return;
  const focusable = [
    ...(container?.querySelectorAll<HTMLElement>(focusableSelector) ?? []),
  ].filter((element) => element.getClientRects().length > 0);

  if (focusable.length === 0) {
    event.preventDefault();
    container?.focus();
    return;
  }

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (
    event.shiftKey &&
    (document.activeElement === first || !container?.contains(document.activeElement))
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || !container?.contains(document.activeElement))
  ) {
    event.preventDefault();
    first.focus();
  }
}
