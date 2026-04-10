/**
 * Simple toast notification.
 */

let toastEl: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function ensureToastElement(): HTMLElement {
  if (toastEl) return toastEl;
  toastEl = document.createElement('div');
  toastEl.className = 'toast';
  document.body.appendChild(toastEl);
  return toastEl;
}

export function showToast(message: string): void {
  const el = ensureToastElement();
  el.textContent = message;
  el.classList.add('visible');

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    el.classList.remove('visible');
  }, 3000);
}
