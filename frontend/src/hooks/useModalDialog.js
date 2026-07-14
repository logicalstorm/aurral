import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

let bodyScrollLockCount = 0;
let previousBodyOverflow = "";
const openDialogStack = [];

function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true",
  );
}

function lockBodyScroll() {
  if (bodyScrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyScrollLockCount += 1;
}

function unlockBodyScroll() {
  bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
  }
}

export function useModalDialog({ open, onClose, closeDisabled = false, initialFocusRef }) {
  const dialogRef = useRef(null);
  const dialogIdRef = useRef(Symbol("modal-dialog"));
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement;
    const dialogId = dialogIdRef.current;
    openDialogStack.push(dialogId);
    lockBodyScroll();

    const focusTimer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog || openDialogStack[openDialogStack.length - 1] !== dialogId) return;
      const preferredFocus = initialFocusRef?.current || dialog.querySelector("[autofocus]");
      const nextFocus = preferredFocus || getFocusableElements(dialog)[0] || dialog;
      nextFocus.focus({ preventScroll: true });
    }, 0);

    const handleKeyDown = (event) => {
      const dialog = dialogRef.current;
      if (!dialog || openDialogStack[openDialogStack.length - 1] !== dialogId) return;

      if (event.key === "Escape" && !closeDisabledRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      const stackIndex = openDialogStack.lastIndexOf(dialogId);
      if (stackIndex >= 0) openDialogStack.splice(stackIndex, 1);
      unlockBodyScroll();
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [initialFocusRef, open]);

  const handleBackdropClick = (event) => {
    const isTopmost = openDialogStack[openDialogStack.length - 1] === dialogIdRef.current;
    if (event.target === event.currentTarget && isTopmost && !closeDisabledRef.current) {
      onCloseRef.current?.();
    }
  };

  return { dialogRef, handleBackdropClick };
}
