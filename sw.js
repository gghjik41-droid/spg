// Меняй это число при каждом обновлении, чтобы сбросить кэш
const CACHE_VERSION = 40;
const CACHE_NAME = 'pso-v' + CACHE_VERSION;

// Список файлов для оффлайн-режима
const filesToCache = [
  './',
  './index.html',
  './npcr.html',
  './molitva.html',
  './pamyatki.html',
  './opros.html',
  './kamery.html',
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

// Функция для выполнения запросов с таймаутом (предотвращает зависания при плохой связи - Lie-Fi)
function fetchWithTimeout(request, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Network timeout (Lie-Fi)'));
    }, timeoutMs);

    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// 3. Стратегии кэширования с защитой от слабого сигнала (Lie-Fi)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Для навигационных запросов - Сначала сеть с быстрым таймаутом (2.5сек)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetchWithTimeout(event.request, 2500)
        .then((networkResponse) => {
          // Сеть работает и вернула валидный ответ - обновляем кэш
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Сеть лежит или отвечает критически медленно - берем из кэша
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              console.log('Слабая сеть/Офлайн: отдали страницу из кэша:', event.request.url);
              return cachedResponse;
            }
            // Нет даже кэша - отдаем сохраненный index.html
            return caches.match('./index.html');
          });
        })
    );
    return;
  }

  // Для изображений из папки топо/ - Cache First (Сначала кэш, если нет - сеть)
  // Топографические знаки статичны, их нет смысла качать заново при слабой сети
  if (shouldCacheDynamically(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          console.log('Топознак загружен мгновенно из кэша:', url.pathname);
          return cachedResponse;
        }
        // Нет в кэше - грузим из сети и сохраняем
        return fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache);
                console.log('Топознак успешно закэширован:', url.pathname);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            return new Response('', { status: 404, statusText: 'Not Found' });
          });
      })
    );
    return;
  }

  // Для остальных запросов - сеть с таймаутом 2 секунды, иначе кэш
  event.respondWith(
    fetchWithTimeout(event.request, 2000)
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
        console.log('Используем кэш для статики (таймаут сети):', url.pathname);
        return caches.match(event.request);
      })
  );
});
