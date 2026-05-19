// lediary-next (v2) エントリポイント。auth 状態で chat or login を切替。
import './styles/base.css';
import './styles/chat.css';
import { renderChat } from './pages/chat';
import { renderLogin } from './pages/login';
import { onAuth } from './auth';

const root = document.getElementById('app')!;

onAuth((user) => {
  root.innerHTML = '';
  if (user) renderChat(root);
  else renderLogin(root);
});
