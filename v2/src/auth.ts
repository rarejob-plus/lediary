// Firebase Auth (Google sign-in)。v1 と同じ uid を共有する。
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

const provider = new GoogleAuthProvider();

let _currentUser: User | null = null;
const listeners = new Set<(u: User | null) => void>();

onAuthStateChanged(auth, (u) => {
  _currentUser = u;
  listeners.forEach((fn) => fn(u));
});

export function getCurrentUser(): User | null {
  return _currentUser;
}

export function onAuth(cb: (u: User | null) => void): () => void {
  listeners.add(cb);
  cb(_currentUser);
  return () => listeners.delete(cb);
}

export function loginWithGoogle(): Promise<User> {
  return signInWithPopup(auth, provider).then((r) => r.user);
}

export function logout(): Promise<void> {
  return signOut(auth);
}
