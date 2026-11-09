# Weryfikacja poprawek GET /instruments — 2026-11-09

## Zmiany i zakres

- `api/prisma/client.ts`: wspólne domyślne limity `pg`: `connectionTimeoutMillis = 1000 ms` oraz serwerowy `statement_timeout = 2000 ms`. Obejmują API, seed i verify. Połączenie/pula i pojedynczy SQL mają łącznie około 3 s budżetu wobec 5 s klienta Angulara. SQL jest przerywany również podczas blokady tabeli i po anulowaniu HTTP. Nie dodano zmiennych środowiskowych. Nie zastosowano `query_timeout`: sam limit oczekiwania klienta nie zastępuje przerwania SQL na serwerze.
- `api/test/database-timeouts.http.test.mjs`, `api/test/support/api-process.mjs`: rzeczywiste procesy NestJS, kontrolowany serwer TCP i osobna sesja PostgreSQL. Testy sprawdzają błędy 500 bez ujawniania szczegółów, sprzątanie socketów, anulowanie HTTP, zakończenie procesu, blokadę SQL i powrót do 108 rekordów. Margines pomiarów wynosi 1500 ms. Żądania testowe używają `Connection: close`, aby oddzielić zamykanie bazy od osobnego oczekiwania HTTP keep-alive.
- `package.json`: pliki testów API działają kolejno, aby blokada tabeli nie kolidowała z testem tymczasowego instrumentu.
- `.gitignore`, `.gitattributes`, `README.md`, `api/prisma/README.md`: ignorowanie paczki, wyłączenie ustawień VS Code z eksportu, dokumentacja limitów, testów i sprawdzania rzeczywistej zawartości ZIP-a.
- Commit obejmuje też zastaną implementację endpointu: `api/main.ts`, `api/src/app.module.ts`, `api/src/instruments/*`, `api/src/prisma/*`, usunięcie fixture'a instrumentów z `api/src/orders/*`, `api/tsconfig.json`, istniejący test HTTP oraz dostosowanie zależności/dokumentacji (`package-lock.json`, `db/README.md`).

`GET /orders` i `GET /contract-types` zachowują fixture'y. Nie zmieniono historii migracji, danych trwałych, konfiguracji Angulara ani WebSocketu. Nie wykonano resetu, usunięcia wolumenów, migracji ani ponownego seeda. Limity są per połączenie/SQL; transakcja seeda zachowuje atomowość i dotychczasowy limit transakcji Prisma.

## Wykonane sprawdzenia

Końcowe `npm run db:verify`, wykonane po testach i kontroli przeglądarkowej, przeszło: **6 / 108 / 213**, pełna zgodność rekordów i relacji z fixture'ami oraz brak pozostawionego instrumentu testowego.

Na Windows polecenia npm uruchomiono przez `npm.cmd`, ponieważ PowerShell blokuje `npm.ps1`.

| Polecenie                   | Wynik                                        |
| --------------------------- | -------------------------------------------- |
| `npm run db:typecheck`      | PASS                                         |
| `npm run format:check`      | PASS                                         |
| `npm run lint`              | PASS: Angular, API i testy bazy              |
| `npm run test:api`          | PASS: 13 testów, w tym 3 nowe testy regresji |
| `npm test -- --watch=false` | PASS: 68 testów, 11 plików                   |
| `npm run build`             | PASS: produkcyjny Angular/SSR                |
| `npm run build:api`         | PASS: generowanie klienta i kompilacja API   |

Test TCP potwierdził HTTP 500 przed upływem 2500 ms, brak pozostawionych socketów po timeout/abort oraz naturalne zakończenie procesu podczas trwającego handshake'u. Test blokady potwierdził 500 po około 2 s; zapytanie zniknęło ze stanu aktywnego w `pg_stat_activity`, gdy blokada nadal była utrzymywana. To samo sprawdzono po anulowaniu HTTP. `ROLLBACK` jest w `finally`; kolejny GET zwraca całą oryginalną tablicę 108 instrumentów. Awarię połączenia sprawdzono na kontrolowanym porcie loopback, bez zatrzymywania PostgreSQL; pozostałe dwa endpointy nadal zwracały dokładne fixture'y.

## Przeglądarka

Sprawdzono produkcyjny SSR w rzeczywistym Chrome, w osobnym kontekście przeglądarki, przez dostarczony przez IDE Chrome DevTools CLI. Strona zwróciła HTTP 200, 213 zleceń i 108 grup. Po uruchomieniu JavaScript kliknięcie przycisku otworzyło formularz; wybór BTCUSD wyświetlił aktualną cenę i gotowość formularza.

Konsola była pusta; przechwycone przed bootstrapem `window.error` i `unhandledrejection` miały puste listy. Nie było błędów NG050x. W `ng-state` były kompletne odpowiedzi: `/orders` 213, `/instruments` 108, `/contract-types` 6. Rejestr sieci Chrome i Performance API wykazały **0** ponownych żądań przeglądarki do każdego z tych trzech endpointów podczas początkowej hydracji. Nie jest to wniosek oparty wyłącznie na surowym HTML ani testach jednostkowych.

WebSocket połączył się z dotychczasowym GeekSoft URL; zaobserwowano 253 wiadomości, wysyłanie subskrypcji/heartbeat, aktualizację ceny oraz 0 błędów i 0 zamknięć w oknie obserwacji. Nie wymuszano awarii zewnętrznej usługi.

Frontend i SSR pochodziły z bieżącego produkcyjnego buildu. Zachowano już działający lokalny proces API użytkownika na porcie 3000, uruchomiony przed tym buildem. Nowe limity i wszystkie regresje bazy sprawdzono niezależnie na bieżąco skompilowanym API w osobnych procesach na wolnych portach.

## Paczka

Świeża nawigacja przeglądarki potwierdziła źródło PostgreSQL: unikalny tymczasowy instrument dodany wyłącznie do bazy pojawił się w odpowiedzi SSR `/instruments` i Transfer Cache (109 rekordów). Nadal nie było ponownych GET-ów przeglądarki ani błędów hydracji. Rekord usunięto w `finally`, po czym sprawdzono powrót do 108 instrumentów. Dowody robocze zapisano lokalnie w ignorowanym `tmp/browser-review-evidence.json` i dwóch migawkach tekstowych.

Sprawdzono rzeczywisty indeks Git: `.env`, `node_modules`, `dist`, `.angular`, `.idea` i `api/prisma/generated` nie są śledzone; `.env.example` jest śledzony. Lokalnych haseł nie kopiowano do dokumentacji ani raportu. Po commicie paczka jest tworzona poleceniem `git archive --format=zip --output=review.zip HEAD`, a zawartość gotowego ZIP-a sprawdzana zgodnie z instrukcją w README: wymagane źródła, fixture'y, schema, historia migracji, manifest, lockfile i `.env.example`, bez plików lokalnych i generowanych.
