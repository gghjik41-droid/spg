// Меняй это число при каждом обновлении
const CACHE_VERSION = 55;
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
        
        // Проверяем есть ли pso-v-next (новая версия)
        const nextCacheExists = await caches.has(CACHE_NAME);
        
        if (foundVersion > 0) {
          // Есть подтверждённый кэш - используем его
          confirmedVersion = foundVersion;
          console.log('[SW] Найден подтверждённый кэш, confirmedVersion:', confirmedVersion);
        } else if (nextCacheExists) {
          // Нет подтверждённого, но есть новая версия - пока не подтверждена!
          // Ищем самую старую версию в кэшах как подтверждённую
          const anyCacheVersion = await findAnyOldCache();
          if (anyCacheVersion > 0) {
            confirmedVersion = anyCacheVersion;
            console.log('[SW] Есть новая версия, использую старую:', confirmedVersion);
          } else {
            // Нет вообще ничего - новый пользователь
            confirmedVersion = CACHE_VERSION;
            console.log('[SW] Новый пользователь, confirmedVersion = CACHE_VERSION:', confirmedVersion);
          }
        } else {
          // Нет никакого кэша - новый пользователь
          confirmedVersion = CACHE_VERSION;
          console.log('[SW] Новый пользователь, confirmedVersion = CACHE_VERSION:', confirmedVersion);
        }
        
        // Если есть новая версия (pso-v-next) но мы используем старую - шлём уведомление
        if (nextCacheExists && foundVersion > 0 && CACHE_VERSION > foundVersion) {
          // Есть новая версия! Уведомляем клиента
          self.clients.matchAll().then(clients => {
            clients.forEach(client => {
              client.postMessage({ type: 'sw_updated', version: CACHE_VERSION });
            });
          });
        }
        
        return handleFetch(event);
      })()
    );
    return;
  }

  return handleFetch(event);
});

// Найти любой старый кэш (кроме next)
async function findAnyOldCache() {
  const keys = await caches.keys();
  let oldestVersion = 0;
  
  for (const key of keys) {
    if (key === 'pso-v-next') continue;
    const match = key.match(/^pso-v(\d+)$/);
    if (match) {
      const v = parseInt(match[1]);
      if (v < oldestVersion || oldestVersion === 0) {
        oldestVersion = v;
      }
    }
  }
  return oldestVersion;
}

async function handleFetch(event) {
  const url = new URL(event.request.url);
  const request = event.request;
  
  // Проверяем - если подтверждённая версия старше текущей, используем ТОЛЬКО её
  // Не даём новой версии отобраться без согласия!
  const usingOldVersion = confirmedVersion < CACHE_VERSION;
  
  debugLog('Fetch', { url: request.url, confirmedVersion: confirmedVersion, cacheVersion: CACHE_VERSION, usingOldVersion: usingOldVersion });

  // Для навигационных запросов - ТОЛЬКО подтверждённый кэш (не даём новой версии без согласия!)
  if (request.mode === 'navigate') {
    return caches.match(request, { cacheName: getConfirmedCacheName() })
      .then((cachedResponse) => {
        if (cachedResponse) {
          console.log('Отдали из подтверждённого кэша (навигация):', request.url);
          return cachedResponse;
        }
        
        // Если используем старую версию - НЕ идём в сеть за новой!
        if (usingOldVersion) {
          console.log('Пользователь на старой версии, не обновляем принудительно');
          return new Response('Обновление доступно. Обновите страницу.', { status: 503 });
        }
        
        // Новый пользователь - идём в сеть
        console.log('Новый пользователь, идём в сеть');
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
      
      // Нет в подтверждённом - если используем старую версию, не обновляем
      if (usingOldVersion) {
        console.log('Старая версия - не обновляем статику');
        return;
      }
      
      // Новый пользователь - идём в сеть
      console.log('Новый пользователь, идём в сеть за статикой');
      return fetch(request)
        .catch(() => {
          console.log('Офлайн, нет кэша');
        });
    });
}
