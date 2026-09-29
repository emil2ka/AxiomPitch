# Контракт бека

Контракт реализован локальным мостом в `server/` (Node.js, SQLite,
127.0.0.1:8787). Фронт ходит в него, если задан `VITE_API_BASE_URL`, и
продолжает работать без него. Кадры камеры на сервер не передаются.
Управление слайдами, чёлка и WebSocket `/live` описаны
в [server/README.md](../server/README.md).

## Презентации

- `POST /api/presentations`: multipart/form-data, поле `file` (PDF).
  Ответ 201: `{ "id": "…", "name": "…", "url": "…", "pageCount": 5 }`
  (плюс `notes` и `createdAt`). `url` отдаёт файл только с этого компьютера.
- `GET /api/presentations`: `{ "items": [ … ] }`, новые сверху.
- `GET /api/presentations/:id` и `GET /api/presentations/:id/file`.
- `PATCH /api/presentations/:id/notes`: `{ "notes": ["…", "…"] }`,
  длина массива равна `pageCount`, иначе 400.

Сервер сам проверяет сигнатуру `%PDF-`, размер до 30 МБ и число страниц
до 60 (считает PDF.js). Иначе 400 с коротким текстом на русском в `error`.
Присланным клиентом метаданным файла и счётчикам сервер не доверяет.

## Итоги

- `POST /api/sessions`: объект SessionResult из `src/lib/types.ts`, опционально
  `presentationId` для привязки к презентации.
- `GET /api/sessions?limit=20&offset=0`:
  `{ "items": [ … ], "total": 3, "limit": 20, "offset": 0 }`, новые сверху.
  Каждый элемент — SessionResult плюс `presentationId` и `savedAt`.

Пример (все длительности в миллисекундах):

```json
{
  "id": "uuid",
  "name": "Первый питч",
  "startedAt": "2026-09-28T04:00:00.000Z",
  "mode": "rehearsal",
  "duration": 120000,
  "perSlide": [60000, 60000],
  "slideTitles": ["Вступление", "Решение"],
  "commands": { "next": 1, "previous": 0, "toggle": 2 },
  "corrections": { "wider": 1 }
}
```

`duration` равна сумме `perSlide`, паузы исключены и отдельным полем не
приходят. `corrections` содержит только коды `frame`, `lost-hand`, `palm`,
`edge`, `horizontal`, `wider`, `steady`; `commands` — ровно `next`,
`previous`, `toggle`; `mode` — `rehearsal` или `live`. Иначе 400. Время
хранится как его измерила вкладка, по часам сервера оно не пересчитывается.
Повторный `id` — 409. Итог репетиции (разбор) и итог выступления — один
объект с полем `mode`: сервер его хранит, но не рисует.

Авторизации нет: мост — доверенный локальный процесс на время хакатона.
Перед любым общим хранением нужно добавить идентификацию пользователя.
