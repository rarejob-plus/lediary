/**
 * Firebase initialization — Firestore + Auth.
 */

import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDSFbfEq0bhSISduFjYIThj_8tQACOJYWc',
  authDomain: 'otokichi-app.firebaseapp.com',
  projectId: 'otokichi-app',
  storageBucket: 'otokichi-app.firebasestorage.app',
  messagingSenderId: '121737888244',
  appId: '1:121737888244:web:c96c5551b1c1d48fb9f9a1',
};

const app = initializeApp(firebaseConfig);

export const db: Firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export const auth = getAuth(app);
