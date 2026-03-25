// Меняй это число при каждом обновлении, чтобы сбросить кэш
const CACHE_VERSION = 14;
const CACHE_NAME = 'pso-v' + CACHE_VERSION;

// Список файлов для оффлайн-режима
const filesToCache = [
  './',
  './index.html',
  './npcr.html',
  './molitva.html',
  './pamyatki.html',
  './opros.html',
  './common.css',
  './panzoom.min.js',
  './222222.html',
  './333333.html',
  './444444.html',
  './555555.html',
  './manifest.json',
  './favicon.png',
  './sw.js'
];

// 1. Установка: сохраняем базу в кэш
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Подготовка оффлайн-копии файлов...');
      return cache.addAll(filesToCache);
    })
  );
  self.skipWaiting();
});

// 2. Активация: чистим старье
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })
    ))
  );
  return self.clients.claim();
});

// 3. Стратегия "Network First" (Сначала сеть)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    // Создаем гонку: либо сеть ответит быстро, либо сработает таймер
    Promise.race([
      fetch(event.request).then((networkResponse) => {
        // Если сеть ответила — обновляем кэш и возвращаем ответ
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }),
      // Таймер на 3000 мс (3 секунды)
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
    ])
    .catch(() => {
      // Сюда попадаем, если интернет пропал ИЛИ если сработал таймаут 3 сек
      return caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          console.log('Сеть тормозит или оффлайн, отдали из кэша:', event.request.url);
          return cachedResponse;
        }
        // Если и в кэше нет — идем на главную
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});