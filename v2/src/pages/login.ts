import { loginWithGoogle } from '../auth';

export function renderLogin(root: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'login-screen';
  wrap.innerHTML = `
    <div class="login-card">
      <h1 class="login-title">Lediary <span>Next</span></h1>
      <p class="login-sub">英語で「友達と話す」感覚で日記を続けるアプリ。</p>
      <button class="login-btn" id="login-btn" type="button">Google でログイン</button>
      <p class="login-note">既存の lediary アカウント (Google) でそのまま使えます。</p>
    </div>
  `;
  root.appendChild(wrap);
  wrap.querySelector('#login-btn')!.addEventListener('click', async () => {
    try {
      await loginWithGoogle();
    } catch (e) {
      console.error(e);
      alert('ログインに失敗しました');
    }
  });
}
