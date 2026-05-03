/**
 * Text selection → floating "Flashcardに保存" button.
 * Ported from rarejob-plus, adapted to use rarejob-plus API via fetch.
 */

import { getIdToken } from '../auth';
import { showToast } from './toast';

import { RJPLUS_API } from '../constants';

let activeBtn: HTMLElement | null = null;

function isEnglishText(text: string): boolean {
  const latin = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (latin.length === 0) return false;
  const nonLatin = latin.replace(/[\u0000-\u024F]/g, '');
  return nonLatin.length / latin.length < 0.3;
}

const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'that', 'this', 'these', 'those',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'has', 'have', 'had',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about',
  'and', 'or', 'but', 'not', 'no', 'so', 'if', 'as', 'than',
]);

function isMeaningfulPhrase(text: string): boolean {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  if (words.length === 1) return words[0]!.length >= 3 && !FUNCTION_WORDS.has(words[0]!);
  if (words.length <= 3) return words.some((w) => !FUNCTION_WORDS.has(w));
  return true;
}

function isWordBoundarySelection(selection: Selection): boolean {
  const range = selection.getRangeAt(0);
  const text = (range.startContainer.textContent || '');
  const before = text.charAt(range.startOffset - 1);
  const after = (range.endContainer.textContent || '').charAt(range.endOffset);
  if (before && /\w/.test(before)) return false;
  if (after && /\w/.test(after)) return false;
  return true;
}

function removeFloatingBtn(): void {
  activeBtn?.remove();
  activeBtn = null;
}

function findSentenceContaining(fullText: string, selectedText: string): string {
  // Split by sentence-ending punctuation, keeping the delimiter
  const sentences = fullText.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    if (sentence.includes(selectedText)) return sentence.trim();
  }
  return selectedText;
}

function getSelectionContext(selection: Selection): string {
  const selectedText = selection.toString().trim();

  // Use diary text — find the sentence containing the selection
  const diaryEl = document.querySelector('.diary-text-selectable');
  if (diaryEl?.textContent) return findSentenceContaining(diaryEl.textContent, selectedText);

  const enInput = document.getElementById('input-en') as HTMLTextAreaElement | null;
  if (enInput?.value) return findSentenceContaining(enInput.value, selectedText);

  const range = selection.getRangeAt(0);
  let container: Node = range.commonAncestorContainer;
  if (container.nodeType === Node.TEXT_NODE) {
    container = container.parentElement!;
  }
  const blockEl = (container as HTMLElement).closest?.('p, div, span, li') as HTMLElement | null;
  return blockEl?.textContent?.trim() || '';
}

export function enableTextSelectionBookmark(container: HTMLElement): void {
  container.addEventListener('mouseup', handleSelectionEnd);
  container.addEventListener('touchend', handleSelectionEnd);

  function handleSelectionEnd(): void {
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        removeFloatingBtn();
        return;
      }

      const selectedText = selection.toString().trim();
      if (
        !selectedText ||
        selectedText.length < 2 ||
        !isEnglishText(selectedText) ||
        !isMeaningfulPhrase(selectedText) ||
        !isWordBoundarySelection(selection)
      ) {
        removeFloatingBtn();
        return;
      }

      const context = getSelectionContext(selection);
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      showFloatingButton(rect, selectedText, context);
    }, 10);
  }
}

function showFloatingButton(rect: DOMRect, text: string, context: string): void {
  removeFloatingBtn();

  const btn = document.createElement('button');
  btn.className = 'text-selection-bookmark-btn';
  btn.textContent = 'Flashcardに保存';
  btn.setAttribute('type', 'button');

  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  btn.style.position = 'absolute';
  btn.style.left = `${rect.left + scrollX + rect.width / 2}px`;
  btn.style.top = `${rect.top + scrollY - 8}px`;
  btn.style.transform = 'translate(-50%, -100%)';
  btn.style.zIndex = '10000';

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    btn.disabled = true;
    btn.textContent = '...';

    const type = text.includes(' ') ? 'expression' : 'word';
    try {
      const token = await getIdToken();
      const res = await fetch(`${RJPLUS_API}/bookmarks/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          text,
          type,
          context,
          japanese: '',
          sourceTitle: 'Lediary',
        }),
      });

      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const bookmarkId = data.id;
      showToast('Flashcardに保存しました', bookmarkId ? {
        label: '取り消す',
        onClick: async () => {
          try {
            const delToken = await getIdToken();
            await fetch(`${RJPLUS_API}/bookmarks/${bookmarkId}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${delToken}` },
            });
            showToast('取り消しました');
          } catch {
            showToast('取り消しに失敗しました');
          }
        },
      } : undefined);
    } catch {
      showToast('保存に失敗しました');
    }

    removeFloatingBtn();
    window.getSelection()?.removeAllRanges();
  });

  document.body.appendChild(btn);
  activeBtn = btn;
}

// Dismiss when clicking elsewhere
document.addEventListener('mousedown', (e) => {
  if (activeBtn && !activeBtn.contains(e.target as Node)) {
    removeFloatingBtn();
  }
});
