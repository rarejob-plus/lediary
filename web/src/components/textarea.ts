// アプリ内 textarea の共通エンハンサ。
// - Cmd / Ctrl + Enter で submit hook を呼ぶ
// - debounce 付き onChange (auto-save 用途)
// - field-sizing 非対応ブラウザ向け auto-resize fallback
//
// 個別 textarea (jp / en / plain-jp / correction-rewrite / expansion-q-input) はそれぞれ
// HTML テンプレで生成され、ここでは要素を受け取って behavior だけ足す。

export interface EnhanceTextareaOptions {
  /** Cmd / Ctrl + Enter で発火する submit。指定が無ければキーバインド無し。 */
  onSubmit?: (el: HTMLTextAreaElement) => void;
  /** 入力中に呼ばれる debounce 付きコールバック。auto-save 等に使う。 */
  onChange?: (value: string, el: HTMLTextAreaElement) => void;
  /** onChange の debounce ms (default 600)。 */
  debounceMs?: number;
  /** field-sizing 未対応ブラウザでも内容ベースに伸ばすか (default true)。 */
  autoResize?: boolean;
}

const supportsFieldSizing = (() => {
  if (typeof CSS === 'undefined' || !CSS.supports) return false;
  try { return CSS.supports('field-sizing', 'content'); } catch { return false; }
})();

export function enhanceTextarea(el: HTMLTextAreaElement, opts: EnhanceTextareaOptions = {}): void {
  const debounceMs = opts.debounceMs ?? 600;

  if (opts.onSubmit) {
    el.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        opts.onSubmit!(el);
      }
    });
  }

  if (opts.onChange) {
    let t: ReturnType<typeof setTimeout> | null = null;
    el.addEventListener('input', () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => opts.onChange!(el.value, el), debounceMs);
    });
  }

  if (opts.autoResize !== false && !supportsFieldSizing) {
    const resize = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    el.addEventListener('input', resize);
    // 初期表示時にも 1 度走らせる (既に value が入ってる時用)
    queueMicrotask(resize);
  }
}
