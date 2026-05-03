interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

let activeToast: HTMLElement | null = null;
let activeTimer: number | null = null;

export function showToast(message: string, action?: ToastAction): void {
  if (activeToast) activeToast.remove();
  if (activeTimer) clearTimeout(activeTimer);

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span class="toast-msg"></span>`;
  (toast.querySelector('.toast-msg') as HTMLElement).textContent = message;

  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', async () => {
      try { await action.onClick(); } catch { /* noop */ }
      toast.remove();
      if (activeTimer) clearTimeout(activeTimer);
      activeToast = null;
    });
    toast.appendChild(btn);
  }

  document.body.appendChild(toast);
  activeToast = toast;
  activeTimer = window.setTimeout(() => {
    toast.classList.add('toast-leaving');
    setTimeout(() => {
      toast.remove();
      if (activeToast === toast) activeToast = null;
    }, 200);
  }, action ? 6000 : 3000);
}
