import { auth } from './firebase';
import {
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';

const provider = new GoogleAuthProvider();

let currentUser: User | null = null;

export function getCurrentUser(): User | null {
  return currentUser;
}

export async function getIdToken(forceRefresh = false): Promise<string> {
  if (!currentUser) throw new Error('Not authenticated');
  return currentUser.getIdToken(forceRefresh);
}

export function loginWithGoogle(): Promise<User> {
  return signInWithPopup(auth, provider).then((r) => r.user);
}

export function logout(): Promise<void> {
  return auth.signOut();
}

export function onAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, (user) => {
    currentUser = user;
    cb(user);
  });
}
