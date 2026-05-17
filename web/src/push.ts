/**
 * lediary push subscription.
 * 朝の通知 (web/api/routes/cron.go の handleDailyReminder) で
 * push_tokens collection を読み取り FCM 送信する。
 * flashcards の src/push.ts と同形式・同じ collection を共有する。
 */

import { getMessaging, getToken, deleteToken } from 'firebase/messaging';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { app, db } from './firebase';

// 注: VAPID key は flashcards / lediary で共通 (同じ Firebase project の Web Push 設定)。
const VAPID_KEY = 'BF1Yy2nQhjoJwkNXU5WYZLksAoAaPBO23D7hEdQz7u0HxrALzwyrfXz3Oo9imNNDwcf8qj9wis37vPz1oMSB4S0';

const STORAGE_KEY = 'lediary_push_token';

let _messaging: ReturnType<typeof getMessaging> | null = null;
function messaging() {
  if (!_messaging) _messaging = getMessaging(app);
  return _messaging;
}

/** ブラウザ / デバイスが Web Push に対応しているか。 */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function isNotificationGranted(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

/** localStorage に token があれば購読中とみなす。 */
export function isSubscribed(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}

/** 購読登録。permission 要求 → SW 登録 → FCM token 取得 → Firestore に保存。 */
export async function subscribePush(userId: string): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const sw = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(messaging(), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: sw,
    });
    if (!token) return false;

    await setDoc(doc(db, 'push_tokens', token), {
      userId,
      token,
      platform: /iPhone|iPad/.test(navigator.userAgent) ? 'ios' : 'web',
      source: 'lediary',
      createdAt: Date.now(),
    });
    localStorage.setItem(STORAGE_KEY, token);
    return true;
  } catch (err) {
    console.error('[push] subscribe failed:', err);
    return false;
  }
}

export async function unsubscribePush(): Promise<void> {
  try {
    const token = localStorage.getItem(STORAGE_KEY);
    if (token) {
      await deleteDoc(doc(db, 'push_tokens', token));
      localStorage.removeItem(STORAGE_KEY);
    }
    if (isPushSupported()) {
      await deleteToken(messaging());
    }
  } catch (err) {
    console.error('[push] unsubscribe failed:', err);
  }
}
