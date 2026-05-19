// lediary-next エントリポイント。
// auth + user doc の状態に応じて 3 画面を切替:
//   未ログイン           → login
//   ログイン済 / persona 未設定 → onboarding (友達選び)
//   ログイン済 / persona 設定済 → chat

import './styles/base.css';
import './styles/chat.css';
import { renderChat } from './pages/chat';
import { renderLogin } from './pages/login';
import { renderOnboarding } from './pages/onboarding';
import { onAuth } from './auth';
import { ensureUser, subscribeUser, type V2User } from './data/user';

const root = document.getElementById('app')!;

let unsubUser: (() => void) | null = null;
let lastRendered: 'login' | 'onboarding' | string | null = null; // 'chat:<personaId>'

function showLogin(): void {
  if (lastRendered === 'login') return;
  lastRendered = 'login';
  root.innerHTML = '';
  renderLogin(root);
}

function showOnboarding(): void {
  if (lastRendered === 'onboarding') return;
  lastRendered = 'onboarding';
  root.innerHTML = '';
  renderOnboarding(root);
}

function showChat(personaId: string): void {
  const key = `chat:${personaId}`;
  if (lastRendered === key) return;
  lastRendered = key;
  root.innerHTML = '';
  renderChat(root, { personaId });
}

onAuth(async (user) => {
  if (unsubUser) { unsubUser(); unsubUser = null; }
  if (!user) { showLogin(); return; }
  await ensureUser(user.uid);
  unsubUser = subscribeUser(user.uid, (u: V2User | null) => {
    if (!u?.personaId) showOnboarding();
    else showChat(u.personaId);
  });
});
