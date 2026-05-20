// lediary-next user doc: personaId, points, unlocks 等を保持。
// doc id == auth uid。 rules で本人のみ read/write。

import { doc, getDoc, setDoc, updateDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db, V2_COLLECTIONS } from '../firebase';

export interface V2User {
  personaId?: string;
  currentPoints: number;
  totalPoints: number;
  unlocks: string[];       // 開放済ギフト id 配列
  createdAt: number;
  updatedAt: number;
}

function userRef(uid: string) {
  return doc(db, V2_COLLECTIONS.users, uid);
}

export async function ensureUser(uid: string): Promise<V2User> {
  const snap = await getDoc(userRef(uid));
  if (snap.exists()) return snap.data() as V2User;
  const init: V2User = {
    currentPoints: 0,
    totalPoints: 0,
    unlocks: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await setDoc(userRef(uid), init);
  return init;
}

export function subscribeUser(uid: string, cb: (u: V2User | null) => void): () => void {
  return onSnapshot(userRef(uid), (snap) => {
    cb(snap.exists() ? (snap.data() as V2User) : null);
  });
}

export async function setPersona(uid: string, personaId: string): Promise<void> {
  await updateDoc(userRef(uid), { personaId, updatedAt: Date.now() });
}

export async function addPoints(uid: string, delta: number): Promise<void> {
  const snap = await getDoc(userRef(uid));
  const cur = snap.exists() ? (snap.data() as V2User) : null;
  const currentPoints = (cur?.currentPoints || 0) + delta;
  const totalPoints = (cur?.totalPoints || 0) + delta;
  await updateDoc(userRef(uid), { currentPoints, totalPoints, updatedAt: Date.now() });
}

/** ギフト交換: currentPoints から cost を引き、unlocks に giftId を追加する。
 *  既に持っている / ポイント不足は例外で返す。原子性は transaction で担保。 */
export async function redeemGift(uid: string, giftId: string, cost: number): Promise<void> {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef(uid));
    if (!snap.exists()) throw new Error('user not initialized');
    const u = snap.data() as V2User;
    const unlocks = Array.isArray(u.unlocks) ? u.unlocks : [];
    if (unlocks.includes(giftId)) throw new Error('already unlocked');
    if ((u.currentPoints || 0) < cost) throw new Error('not enough points');
    tx.update(userRef(uid), {
      currentPoints: u.currentPoints - cost,
      unlocks: [...unlocks, giftId],
      updatedAt: Date.now(),
    });
  });
}
