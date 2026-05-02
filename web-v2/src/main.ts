import './styles/base.css';
import './styles/timeline.css';
import './styles/editor.css';
import './styles/entry.css';
import { render } from './router';
import { onAuth } from './auth';

// 認証状態が変わったら（ログイン/ログアウト）UI を再レンダリング
let firstAuthSettled = false;
onAuth(() => {
  if (!firstAuthSettled) {
    firstAuthSettled = true;
    render();
  } else {
    render();
  }
});

// 認証 init を待たずに先に表示（mock データで描画 → 認証確定後に再描画）
render();
