/**
 * Simple toast notification with optional action button.
 */

let toastEl: HTMLElement | null = null;
let toastTextEl: HTMLElement | null = null;
let toastActionEl: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function ensureToastElement(): HTMLElement {
  if (toastEl) return toastEl;
  toastEl = document.createElement('div');
  toastEl.className = 'toast';

  toastTextEl = document.createElement('span');
  toastTextEl.className = 'toast-text';

  toastActionEl = document.createElement('button');
  toastActionEl.className = 'toast-action';

  toastEl.append(toastTextEl, toastActionEl);
  document.body.appendChild(toastEl);
  return toastEl;
}

export function showToast(message: string, action?: { label: string; onClick: () => void }): void {
  ensureToastElement();
  toastTextEl!.textContent = message;

  if (action) {
    toastActionEl!.textContent = action.label;
    toastActionEl!.style.display = '';
    const handler = () => {
      action.onClick();
      toastEl!.classList.remove('visible');
      if (hideTimer) clearTimeout(hideTimer);
      toastActionEl!.removeEventListener('click', handler);
    };
    toastActionEl!.replaceWith(toastActionEl!.cloneNode(true));
    toastActionEl = toastEl!.querySelector('.toast-action')!;
    toastActionEl!.textContent = action.label;
    toastActionEl!.style.display = '';
    toastActionEl!.addEventListener('click', handler);
  } else {
    toastActionEl!.style.display = 'none';
  }

  toastEl!.classList.add('visible');

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    toastEl!.classList.remove('visible');
  }, action ? 5000 : 3000);
}
