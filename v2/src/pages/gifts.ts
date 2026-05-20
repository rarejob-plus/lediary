// ギフト交換 modal。現在 MP 表示 + カタログ + 「交換」ボタン。
// 交換成功時に user.unlocks に giftId を追加して currentPoints を減らす。

import { GIFTS, type Gift } from '../data/gifts';
import { redeemGift, subscribeUser, type V2User } from '../data/user';
import { icons } from '../components/icons';

export function renderGifts(root: HTMLElement, userId: string): void {
  const wrap = document.createElement('div');
  wrap.className = 'gifts-screen';
  wrap.innerHTML = `
    <header class="gifts-header">
      <h2 class="gifts-title">ギフト</h2>
      <div class="gifts-mp" id="gifts-mp">— MP</div>
    </header>
    <p class="gifts-sub">日記投稿 +10MP、What if 選択 +5MP。貯めると下のギフトと交換できます。</p>
    <div class="gifts-list" id="gifts-list"></div>
  `;
  root.appendChild(wrap);
  const listEl = wrap.querySelector('#gifts-list') as HTMLElement;
  const mpEl = wrap.querySelector('#gifts-mp') as HTMLElement;

  let currentUser: V2User | null = null;

  function renderList(): void {
    listEl.innerHTML = GIFTS.map((g) => renderGiftCard(g, currentUser)).join('');
    listEl.querySelectorAll<HTMLButtonElement>('.gift-redeem').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = b.dataset.id!;
        const cost = Number(b.dataset.cost || '0');
        b.disabled = true;
        b.textContent = '交換中…';
        try {
          await redeemGift(userId, id, cost);
        } catch (e) {
          console.error('[gifts] redeem failed', e);
          alert(String((e as Error).message) || '交換に失敗しました');
          b.disabled = false;
          b.textContent = '交換';
        }
      });
    });
  }

  const unsub = subscribeUser(userId, (u) => {
    currentUser = u;
    mpEl.textContent = `${u?.currentPoints ?? 0} MP`;
    renderList();
  });
  // 親 modal が消されたら listener 解除
  const observer = new MutationObserver(() => {
    if (!document.contains(wrap)) {
      unsub();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function renderGiftCard(g: Gift, u: V2User | null): string {
  const owned = !!u?.unlocks?.includes(g.id);
  const enough = (u?.currentPoints ?? 0) >= g.costMp;
  const buttonLabel = owned ? '保有中' : enough ? '交換' : '不足';
  const buttonClass = owned ? 'gift-redeem gift-redeem--owned' : enough ? 'gift-redeem' : 'gift-redeem gift-redeem--locked';
  return `
    <article class="gift-card${owned ? ' gift-card--owned' : ''}">
      <div class="gift-icon" style="background:${g.color};">${icons[g.icon](24)}</div>
      <div class="gift-meta">
        <div class="gift-name">${g.name}</div>
        <div class="gift-desc">${g.description}</div>
        <div class="gift-cost">${g.costMp} MP</div>
      </div>
      <button class="${buttonClass}" type="button" data-id="${g.id}" data-cost="${g.costMp}"
        ${owned || !enough ? 'disabled' : ''}>
        ${buttonLabel}
      </button>
    </article>
  `;
}
