/**
 * Settings page — user preferences (TTS voice, etc.)
 */

import { navigate } from '../router';

const VOICES = [
  { name: 'Achird', desc: 'Friendly, natural' },
  { name: 'Orus', desc: 'Calm, composed' },
  { name: 'Kore', desc: 'Collected, low' },
  { name: 'Charon', desc: 'Deep, resonant' },
  { name: 'Fenrir', desc: 'Strong, clear' },
  { name: 'Puck', desc: 'Bright, upbeat' },
  { name: 'Zephyr', desc: 'Light, airy' },
  { name: 'Leda', desc: 'Warm, friendly' },
  { name: 'Aoede', desc: 'Melodic, expressive' },
];

const SETTINGS_KEY = 'lediary_settings';

export interface LediarySettings {
  ttsVoice: string;
}

export function getSettings(): LediarySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ttsVoice: 'Achird', ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ttsVoice: 'Achird' };
}

function saveSettings(s: LediarySettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function settingsHTML(): string {
  return `
    <div class="settings-page">
      <div class="settings-header">
        <button class="back-btn" id="settings-back">&larr;</button>
        <h2>Settings</h2>
      </div>
      <div class="settings-body">
        <div class="settings-section">
          <h3 class="settings-section-title">TTS Voice</h3>
          <p class="settings-section-desc">音読練習で使用する声を選択</p>
          <div id="voice-list" class="voice-list"></div>
          <div id="voice-preview" class="voice-preview"></div>
        </div>
      </div>
    </div>
  `;
}

export function initSettings(): void {
  const settings = getSettings();

  document.getElementById('settings-back')?.addEventListener('click', () => {
    navigate('/');
  });

  const list = document.getElementById('voice-list')!;
  list.innerHTML = VOICES.map((v) => `
    <label class="voice-option ${v.name === settings.ttsVoice ? 'selected' : ''}">
      <input type="radio" name="tts-voice" value="${v.name}" ${v.name === settings.ttsVoice ? 'checked' : ''} />
      <span class="voice-name">${v.name}</span>
      <span class="voice-desc">${v.desc}</span>
      <button class="voice-try-btn btn btn-sm btn-ghost" data-voice="${v.name}">Try</button>
    </label>
  `).join('');

  // Select voice
  list.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.name !== 'tts-voice') return;
    settings.ttsVoice = target.value;
    saveSettings(settings);
    list.querySelectorAll('.voice-option').forEach((el) => el.classList.remove('selected'));
    target.closest('.voice-option')?.classList.add('selected');
  });

  // Try voice
  list.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('.voice-try-btn') as HTMLButtonElement | null;
    if (!btn) return;
    e.preventDefault();

    const voice = btn.dataset.voice || 'Orus';
    btn.disabled = true;
    btn.textContent = '...';

    try {
      const { getIdToken } = await import('../auth');
      const token = await getIdToken();
      const res = await fetch(`/api/diary/tts?text=${encodeURIComponent('Have a wonderful day!')}&voice=${voice}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const buf = await res.arrayBuffer();
      const ctx = new AudioContext();
      const audio = await ctx.decodeAudioData(buf);
      const source = ctx.createBufferSource();
      source.buffer = audio;
      source.connect(ctx.destination);
      source.start();
    } catch {
      // silent fail
    }
    btn.disabled = false;
    btn.textContent = 'Try';
  });
}
