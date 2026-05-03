/**
 * Firebase initialization — Auth only.
 */

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyDSFbfEq0bhSISduFjYIThj_8tQACOJYWc',
  authDomain: 'otokichi-app.firebaseapp.com',
  projectId: 'otokichi-app',
  storageBucket: 'otokichi-app.firebasestorage.app',
  messagingSenderId: '121737888244',
  appId: '1:121737888244:web:c96c5551b1c1d48fb9f9a1',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
