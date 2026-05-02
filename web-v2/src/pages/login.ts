import { loginWithGoogle } from '../auth';

export function renderLogin(root: HTMLElement, onSuccess: () => void): void {
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
      <div style="max-width:320px;width:100%;text-align:center;">
        <div style="font-family:var(--serif);font-size:32px;font-weight:600;letter-spacing:-0.02em;margin-bottom:12px;">Lediary</div>
        <p style="color:var(--text-muted);font-size:14px;margin-bottom:32px;line-height:1.7;">
          毎日のひとことから、英語が育つ日記
        </p>
        <button class="btn btn-primary" id="g-login" style="width:100%;padding:14px;">
          Google でログイン
        </button>
        <p style="color:var(--text-faint);font-size:11px;margin-top:24px;">
          ログインデータは Firestore に保存されます
        </p>
      </div>
    </div>
  `;

  const btn = root.querySelector('#g-login') as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'ログイン中…';
    try {
      await loginWithGoogle();
      onSuccess();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Google でログイン';
      console.error(e);
      alert('ログインに失敗しました');
    }
  });
}
