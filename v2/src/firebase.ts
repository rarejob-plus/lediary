// Firebase 初期化。v1 と同じ otokichi-app project を共有 (Auth / Firestore / Storage)。
// データは collection 名 / Storage path で v1 と棲み分け (lediary-v2-* prefix)。
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDSFbfEq0bhSISduFjYIThj_8tQACOJYWc',
  authDomain: 'otokichi-app.firebaseapp.com',
  projectId: 'otokichi-app',
  storageBucket: 'otokichi-app.firebasestorage.app',
  messagingSenderId: '121737888244',
  appId: '1:121737888244:web:c96c5551b1c1d48fb9f9a1',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

/** v2 用の Firestore コレクション prefix。v1 (lediary-posts 等) と完全に分離する。 */
export const V2_COLLECTIONS = {
  chats: 'lediary-v2-chats',
  users: 'lediary-v2-users',
  gifts: 'lediary-v2-gifts',
} as const;

/** v2 用の Storage path prefix。 */
export const V2_STORAGE = {
  audio: 'lediary-v2/audio',
} as const;
