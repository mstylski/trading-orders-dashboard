# Trading Orders Dashboard

Jednoekranowa aplikacja Angular 22 do przeglądania zleceń pogrupowanych według symbolu. Pokazuje wynik pozycji na podstawie kwotowań WebSocket, pozwala lokalnie dodać lub zamknąć zlecenie oraz przełączyć motyw jasny, ciemny lub systemowy.

## Uruchomienie

Wymagany jest Node.js 24 LTS (co najmniej 24.15.0) i npm. Po instalacji zależności uruchom serwer developerski:

```bash
npm install
npm start
```

Aplikacja jest dostępna pod adresem `http://localhost:4200/`. Do pobrania danych i kwotowań potrzebuje połączenia z zewnętrznymi usługami GeekSoft. Repozytorium nie zawiera backendu.

## Sprawdzenie projektu

```bash
npm run build
npm test -- --watch=false
```

Testy jednostkowe i integracyjne używają podstawionych odpowiedzi HTTP oraz WebSocket. Projekt nie ma skonfigurowanego narzędzia do testów E2E.

## Struktura i przepływ danych

- `src/app/features/orders/data` pobiera i sprawdza dane z trzech endpointów HTTP oraz obsługuje WebSocket, subskrypcje symboli i ponowne łączenie.
- `src/app/features/orders/state` przechowuje zlecenia i udostępnia sygnały oraz operacje dodania i zamknięcia. Store jest tworzony dla strony i zwalnia połączenie po jej zniszczeniu.
- `src/app/features/orders/domain` zawiera czyste obliczenia wartości kontraktów, profitów i grup.
- `src/app/features/orders/components` zawiera formularz i tabelę; `orders-page` łączy je ze stanem oraz obsługuje powiadomienia.
- `src/app/core` przechowuje preferencję motywu, a `src/app/shared` zawiera komponenty interfejsu używane przez stronę.

Po załadowaniu danych HTTP store wyznacza grupy zleceń. Kwotowania aktualizują ich profity na żywo. Po zerwaniu połączenia aplikacja pokazuje ostatnie ceny jako nieaktualne i ponawia połączenie; dodanie zlecenia wymaga świeżej ceny wybranego symbolu.

Dodawanie i zamykanie zleceń zmienia wyłącznie stan w pamięci przeglądarki. Odświeżenie strony ponownie pobiera dane początkowe. W `localStorage` zapisywana jest tylko preferencja motywu.
