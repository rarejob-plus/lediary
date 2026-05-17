/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDSFbfEq0bhSISduFjYIThj_8tQACOJYWc',
  authDomain: 'otokichi-app.firebaseapp.com',
  projectId: 'otokichi-app',
  storageBucket: 'otokichi-app.firebasestorage.app',
  messagingSenderId: '121737888244',
  appId: '1:121737888244:web:c96c5551b1c1d48fb9f9a1',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  if (!title) return;
  const link =
    (payload.fcmOptions && payload.fcmOptions.link) ||
    (payload.data && payload.data.link) ||
    'https://lediary.web.app/phrases';
  self.registration.showNotification(title, {
    body: body || '',
    icon: '/icons/icon-192.png',
    data: { link },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.link) || '/phrases';
  event.waitUntil(self.clients.openWindow(target));
});
