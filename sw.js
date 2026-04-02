// Меняй это число при каждом обновлении
const CACHE_VERSION = 51;
const CACHE_NAME = 'pso-v-next';  // Всегда один "новый" кэш

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

// 2. Активация: уведомляем клиентов, НЕ удаляем старый кэш
self.addEventListener('activate', (event) => {
  console.log('SW: Активация началась, версия', CACHE_VERSION);
  event.waitUntil(
    self.clients.matchAll().then(clients => {
      console.log('SW: Найдено клиентов:', clients.length);
      clients.forEach(client => {
        console.log('SW: Отправляю sw_updated клиенту');
        client.postMessage({ type: 'sw_updated', version: CACHE_VERSION });
      });
    })
  );
  // Не делаем claim() автоматически - только после согласия пользователя
});

// Сообщение от клиента: применить обновление или передать версию
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skipWaiting') {
    self.skipWaiting().then(() => {
      self.clients.claim();
    });
  }
  
  // Клиент сообщает подтверждённую версию
  if (event.data && event.data.type === 'set_confirmed_version') {
    confirmedVersion = event.data.version;
    console.log('SW: Подтверждённая версия установлена:', confirmedVersion);
  }
});

// Подтверждённая версия (по умолчанию - текущая)
let confirmedVersion = CACHE_VERSION;

// Проверка, нужно ли динамически кэшировать URL
function shouldCacheDynamically(url) {
  return DYNAMIC_CACHE_PATTERNS.some(pattern => pattern.test(url));
}

// Имя подтверждённого кэша
function getConfirmedCacheName() {
  return 'pso-v' + confirmedVersion;
}

// 3. Стратегия: пользователь видит старую версию, пока не подтвердит обновление
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Для навигационных запросов - сначала кэш подтверждённой версии
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(event.request, { cacheName: getConfirmedCacheName() })
        .then((cachedResponse) => {
          if (cachedResponse) {
            console.log('Отдали из кэша (навигация):', event.request.url);
            return cachedResponse;
          }
          // Нет в кэше подтверждённой версии - пробуем сеть
          return fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, responseToCache);
                });
              }
              return networkResponse;
            })
            .catch(() => {
              // Сеть недоступна - показываем главную
              return caches.match('./index.html');
            });
        })
    );
    return;
  }

  // Для статических ресурсов - сначала подтверждённый кэш, потом "новый" (pso-v-next)
  event.respondWith(
    caches.match(event.request, { cacheName: getConfirmedCacheName() })
      .then((cachedResponse) => {
        if (cachedResponse) {
          console.log('Отдали из подтверждённого кэша:', event.request.url);
          return cachedResponse;
        }
        
        // Нет в подтверждённом - пробуем "новый"
        return caches.match(event.request, { cacheName: CACHE_NAME })
          .then((nextResponse) => {
            if (nextResponse) {
              console.log('Отдали из "нового" кэша:', event.request.url);
              return nextResponse;
            }
            
            // Нет нигде - идём в сеть (но НЕ сохраняем!)
            return fetch(event.request)
              .catch(() => {
                // Сеть недоступна - пробуем любой кэш
                return caches.keys().then(keys => {
                  for (let key of keys) {
                    if (key.startsWith('pso-v')) {
                      return caches.match(event.request, { cacheName: key });
                    }
                  }
                });
              });
          });
      })
  );
});
