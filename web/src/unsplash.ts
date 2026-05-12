// Unsplash cover image fetching — Gemini が抽出した coverKeyword を投げて
// 1 枚選ぶ。access key は Unsplash の規約上 client-side に置いて OK な扱い
// (アプリケーションを識別するためのもの、認証ではない)。

const ACCESS_KEY = import.meta.env.VITE_UNSPLASH_ACCESS_KEY as string | undefined;

export interface UnsplashCover {
  url: string;
  photographer: string;
  photographerUrl: string;
  downloadLocation: string;
}

interface Photo {
  urls: { regular: string };
  user: { name: string; links: { html: string } };
  links: { download_location: string };
  color?: string;
}

// hex (#rrggbb) → 知覚輝度 0-255。基準: ITU-R BT.601。
function brightnessFromHex(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 128;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

async function searchPhotos(query: string): Promise<Photo[]> {
  if (!ACCESS_KEY) return [];
  const params = new URLSearchParams({
    query,
    per_page: '20',
    orientation: 'landscape',
    content_filter: 'high',
    featured: 'true',
  });
  let r = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
    headers: { Authorization: `Client-ID ${ACCESS_KEY}`, 'Accept-Version': 'v1' },
  });
  if (!r.ok) {
    console.warn('Unsplash search failed:', r.status, query);
    return [];
  }
  let data: { results: Photo[] } = await r.json();
  if (!data.results?.length) {
    // featured=true で 0 件のときは外して再検索
    params.delete('featured');
    r = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
      headers: { Authorization: `Client-ID ${ACCESS_KEY}`, 'Accept-Version': 'v1' },
    });
    if (!r.ok) return [];
    data = await r.json();
  }
  return data.results || [];
}

export async function fetchUnsplashCover(keyword: string): Promise<UnsplashCover | null> {
  if (!keyword || !ACCESS_KEY) return null;
  try {
    // 複合語が 0 件になったときは左から 1 語ずつ落として再検索。
    // 修飾語 (japanese / tokyo) は前置されがちなので末尾を残す方が当たりやすい。
    const tokens = keyword.trim().split(/\s+/);
    let results: Photo[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const q = tokens.slice(i).join(' ');
      results = await searchPhotos(q);
      if (results.length) {
        if (i > 0) console.warn(`Unsplash fallback: "${keyword}" → "${q}"`);
        break;
      }
    }
    if (!results.length) {
      console.warn('Unsplash 0 results across all fallbacks:', keyword);
      return null;
    }

    // dominant color の輝度で暗いものを除外
    const scored = results.map((p) => ({ p, b: brightnessFromHex(p.color || '') }));
    let bright = scored.filter((x) => x.b >= 110);
    if (bright.length === 0) bright = scored.filter((x) => x.b >= 80);
    if (bright.length === 0) bright = scored;

    bright.sort((a, b) => b.b - a.b);
    const pool = bright.slice(0, 5);
    const pick = pool[Math.floor(Math.random() * pool.length)]!.p;
    return {
      url: pick.urls.regular,
      photographer: pick.user.name,
      photographerUrl: pick.user.links.html,
      downloadLocation: pick.links.download_location,
    };
  } catch (e) {
    console.warn('Unsplash fetch error:', e);
    return null;
  }
}

// Unsplash API ガイドライン: 画像を実際に使うとき download エンドポイントを叩く
export async function notifyUnsplashDownload(downloadLocation: string): Promise<void> {
  if (!ACCESS_KEY || !downloadLocation) return;
  try {
    await fetch(downloadLocation, { headers: { Authorization: `Client-ID ${ACCESS_KEY}` } });
  } catch (e) {
    console.warn('Unsplash download notify failed:', e);
  }
}
