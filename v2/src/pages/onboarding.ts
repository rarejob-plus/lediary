// 初回ユーザー向けの「友達を選ぶ」画面。6 人から 1 人選んで personaId に永続化。
// 後から chat ヘッダーをクリックして変更も可能 (同じ画面を再利用)。

import { PERSONAS } from '../data/personas';
import { setPersona } from '../data/user';
import { getCurrentUser } from '../auth';
import { icons } from '../components/icons';

export function renderOnboarding(root: HTMLElement, opts?: { changeMode?: boolean }): void {
  const user = getCurrentUser();
  if (!user) return;
  const wrap = document.createElement('div');
  wrap.className = 'onboarding-screen';
  wrap.innerHTML = `
    <div class="onboarding-card">
      <h2 class="onboarding-title">${opts?.changeMode ? '友達を変える' : '友達を選ぼう'}</h2>
      <p class="onboarding-sub">
        ${opts?.changeMode
          ? 'チャット相手を切り替えます。これまでのやり取りは残ります。'
          : '今日からチャットする「英語の友達」を 1 人選んでください。後でいつでも変更できます。'}
      </p>
      <div class="persona-grid">
        ${PERSONAS.map((p) => `
          <button class="persona-card" data-id="${p.id}" type="button">
            <div class="persona-avatar" style="background:${p.color};">${icons[p.icon](24)}</div>
            <div class="persona-name">${p.name}, ${p.age}</div>
            <div class="persona-city">${p.city}</div>
            <div class="persona-vibe">${p.vibe}</div>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  root.appendChild(wrap);

  wrap.querySelectorAll<HTMLButtonElement>('.persona-card').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id!;
      wrap.querySelectorAll('.persona-card').forEach((b) => (b as HTMLButtonElement).disabled = true);
      btn.classList.add('selected');
      try {
        await setPersona(user.uid, id);
        // main の onAuth + subscribeUser によって自動で chat 画面に遷移する。
      } catch (e) {
        console.error(e);
        alert('保存に失敗しました');
        wrap.querySelectorAll('.persona-card').forEach((b) => (b as HTMLButtonElement).disabled = false);
      }
    });
  });
}
