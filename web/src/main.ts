import './styles/base.css';
import './styles/timeline.css';
import './styles/editor.css';
import './styles/entry.css';
import './styles/sheet.css';
import { render } from './router';
import { onAuth, getCurrentUser } from './auth';
import { isPushSupported, isNotificationGranted, isSubscribed, subscribePush } from './push';

// 認証状態が変わったら（ログイン/ログアウト）UI を再レンダリング
let firstAuthSettled = false;
onAuth(() => {
  if (!firstAuthSettled) {
    firstAuthSettled = true;
    render();
  } else {
    render();
  }
  // 既に通知許可済かつ購読中なら、ログイン後にトークンをリフレッシュ。
  // 失敗しても UI には出さず silent。
  const u = getCurrentUser();
  if (u && isPushSupported() && isNotificationGranted() && isSubscribed()) {
    void subscribePush(u.uid);
  }
});

// 認証 init を待たずに先に表示（mock データで描画 → 認証確定後に再描画）
render();
