// Меняй это число при каждом обновлении, чтобы сбросить кэш
const CACHE_VERSION = 45;
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
  './index.css',
  './panzoom.min.js',
  './222222.html',
  './manifest.json',
  './sw.js',
  './favicon.png'
];

// Паттерны для динамического кэширования
const DYNAMIC_CACHE_PATTERNS = [
  /\/топо\//i  // Все файлы из папки топо/
];

// 1. Установка: сохраняем базу в кэш (с обработкой отсутствующих файлов)
self.addEventListener('install', (event) => {
  console.log('SW: Установка началась, версия', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Подготовка оффлайн-копии файлов...');
      // Добавляем файлы по одному, игнорируя ошибки для отсутствующих
      return Promise.allSettled(
        filesToCache.map(url => 
          fetch(url).then(response => {
            if (response.ok) {
              return cache.put(url, response);
            }
          })
        )
      ).then(results => {
        results.forEach((result, i) => {
          if (result.status === 'rejected') {
            console.log('Файл не добавлен в кэш:', filesToCache[i]);
          }
        });
      });
    })
  );
  // НЕ вызываем skipWaiting() - даём пользователю самому решить, когда обновиться
});

// 2. Активация: чистим старье и уведомляем клиентов
self.addEventListener('activate', (event) => {
  console.log('SW: Активация началась');
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })
    )).then(() => {
      console.log('SW: Чистка кэша завершена');
      // Уведомляем所有 клиентов о доступности обновления
      return self.clients.matchAll().then(clients => {
        console.log('SW: Найдено клиентов:', clients.length);
        clients.forEach(client => {
          console.log('SW: Отправляю sw_updated клиенту');
          client.postMessage({ type: 'sw_updated' });
        });
      });
    })
  );
  // Не делаем claim() автоматически - только после согласия пользователя
});

// Сообщение от клиента: применить обновление
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skipWaiting') {
    self.skipWaiting().then(() => {
      self.clients.claim();
    });
  }
});

// Проверка, нужно ли динамически кэшировать URL
function shouldCacheDynamically(url) {
  return DYNAMIC_CACHE_PATTERNS.some(pattern => pattern.test(url));
}

// 3. Стратегия "Network First" (Сначала сеть, потом кэш)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Для навигационных запросов - сначала сеть
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Сеть работает - обновляем кэш
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Сеть недоступна - пробуем кэш
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              console.log('Офлайн, отдали из кэша:', event.request.url);
              return cachedResponse;
            }
            // Нет даже кэша - показываем ошибку или главную
            return caches.match('./index.html');
          });
        })
    );
    return;
  }

  // Для изображений из папки топо/ - Network First (сначала сеть, потом кэш)
  // Стратегия: отдаём из сети сразу, параллельно сохраняем в кэш
  if (shouldCacheDynamically(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Сеть работает - отдаём ответ и параллельно сохраняем в кэш
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
              console.log('Топознак сохранён в кэш:', url.pathname);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Сеть недоступна - пробуем кэш
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              console.log('Топознак из кэша (офлайн):', url.pathname);
              return cachedResponse;
            }
            // Нет даже кэша - возвращаем пустой ответ
            return new Response('', { status: 404, statusText: 'Not Found' });
          });
        })
    );
    return;
  }

  // Для остальных запросов - используем кэш если нет сети
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
