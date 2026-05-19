// lediary-next (v2) のエントリポイント。LINE 風チャット + IF ストーリー + ポイント。
// 詳細は順次実装。当面は scaffolding として「v2 ですよ」だけ出す。
import './styles/base.css';
import './firebase';

const root = document.getElementById('app');
if (root) {
  root.innerHTML = `
    <div style="max-width:520px;margin:48px auto;padding:32px;text-align:center;font-family:system-ui;">
      <h1 style="font-family:'Lora',serif;font-size:32px;margin:0 0 12px;">Lediary <span style="color:#2563eb;">Next</span></h1>
      <p style="color:#86868b;font-size:14px;line-height:1.7;">
        まもなく公開。<br>
        AI 友達とのチャット、IF ストーリー、モチベーションポイント。
      </p>
    </div>
  `;
}
