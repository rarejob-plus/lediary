/**
 * Auth module — Firebase Auth with Google provider.
 */

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

export async function getIdToken(): Promise<string> {
  if (!currentUser) throw new Error('Not authenticated');
  return currentUser.getIdToken();
}

export function loginWithGoogle(): Promise<User> {
  return signInWithPopup(auth, provider).then((result) => result.user);
}

export function logout(): Promise<void> {
  return auth.signOut();
}

export function onAuth(callback: (user: User | null) => void): void {
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    callback(user);
  });
}
