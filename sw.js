// Меняй это число при каждом обновлении
const CACHE_VERSION = 53;
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

// Подтверждённая версия (по умолчанию - 0, найдём при первом запросе)
let confirmedVersion = 0;

// Проверка, нужно ли динамически кэшировать URL
function shouldCacheDynamically(url) {
  return DYNAMIC_CACHE_PATTERNS.some(pattern => pattern.test(url));
}

// Имя подтверждённого кэша
function getConfirmedCacheName() {
  return 'pso-v' + confirmedVersion;
}

// Найти самый старый доступный кэш (подтверждённый пользователем, НЕ pso-v-next)
async function findConfirmedCache() {
  const keys = await caches.keys();
  let oldestVersion = 0;
  let oldestCacheName = null;
  
  for (const key of keys) {
    // Исключаем pso-v-next!
    if (key === 'pso-v-next') continue;
    
    const match = key.match(/^pso-v(\d+)$/);
    if (match) {
      const v = parseInt(match[1]);
      // Ищем минимальную версию (самый старый подтверждённый кэш)
      if (v < oldestVersion || oldestVersion === 0) {
        oldestVersion = v;
        oldestCacheName = key;
      }
    }
  }
  
  console.log('[SW] Найден подтверждённый кэш:', oldestCacheName, 'версия', oldestVersion);
  return oldestVersion;
}

// Инициализация при старте
async function initConfirmedVersion() {
  if (confirmedVersion === 0) {
    confirmedVersion = await findOldestCache();
    console.log('[SW] Инициализирован confirmedVersion:', confirmedVersion);
  }
}

// Для отладки
function debugLog(msg, data) {
  console.log('[DEBUG] ' + msg, data || '');
}

// 3. Стратегия: пользователь видит старую версию, пока не подтвердит обновление
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Инициализируем версию при первом запросе
  if (confirmedVersion === 0) {
    event.respondWith(
      (async () => {
        // Ищем подтверждённый кэш
        const foundVersion = await findConfirmedCache();
        if (foundVersion > 0) {
          confirmedVersion = foundVersion;
          console.log('[SW] Найден подтверждённый кэш, confirmedVersion:', confirmedVersion);
        } else {
          // Нет подтверждённого кэша - новый пользователь
          confirmedVersion = CACHE_VERSION;
          console.log('[SW] Новый пользователь, confirmedVersion = CACHE_VERSION:', confirmedVersion);
        }
        return handleFetch(event);
      })()
    );
    return;
  }

  return handleFetch(event);
});

async function handleFetch(event) {
  const url = new URL(event.request.url);
  const request = event.request;
  
  debugLog('Fetch', { url: request.url, confirmedVersion: confirmedVersion, cacheVersion: CACHE_VERSION });

  // Для навигационных запросов - ТОЛЬКО подтверждённый кэш
  if (request.mode === 'navigate') {
    return caches.match(request, { cacheName: getConfirmedCacheName() })
      .then((cachedResponse) => {
        if (cachedResponse) {
          console.log('Отдали из подтверждённого кэша (навигация):', request.url);
          return cachedResponse;
        }
        // Нет подтверждённого кэша - новый пользователь, идём в сеть
        console.log('Нет подтверждённого кэша, идём в сеть');
        return fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // Офлайн - показываем главную
            return caches.match('./index.html');
          });
      });
  }

  // Для статических ресурсов - ТОЛЬКО подтверждённый кэш
  return caches.match(request, { cacheName: getConfirmedCacheName() })
    .then((cachedResponse) => {
      if (cachedResponse) {
        console.log('Отдали из подтверждённого кэша:', request.url);
        return cachedResponse;
      }
      
      // Нет в подтверждённом - идём в сеть
      console.log('Нет подтверждённого кэша для:', request.url);
      return fetch(request)
        .catch(() => {
          // Офлайн - ничего не делаем, браузер сам покажет офлайн страницу
          console.log('Офлайн, нет кэша для:', request.url);
        });
    });
}
