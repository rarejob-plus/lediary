/**
 * Login page — Google auth.
 */

import { loginWithGoogle } from '../auth';
import { navigate } from '../router';

export function loginHTML(): string {
  return `
    <div class="login-screen">
      <h1>Lediary</h1>
      <p>3行日記で英語力を伸ばそう</p>
      <button id="google-login-btn" class="google-login-btn">Googleでログイン</button>
    </div>
  `;
}

export function initLogin(): void {
  const btn = document.getElementById('google-login-btn');
  btn?.addEventListener('click', async () => {
    try {
      btn.textContent = 'ログイン中...';
      (btn as HTMLButtonElement).disabled = true;
      await loginWithGoogle();
      navigate('/');
    } catch (err) {
      console.error('Login failed:', err);
      btn.textContent = 'Googleでログイン';
      (btn as HTMLButtonElement).disabled = false;
    }
  });
}
