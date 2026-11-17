import {
  AddOrderError,
  PriceUnavailableReason,
  ProfitUnavailableReason,
} from '../models/order.models';

export const profitReasonLabel: Record<ProfitUnavailableReason, string> = {
  'missing-contract': 'Brak wartości kontraktu dla tego instrumentu.',
  'awaiting-quote': 'Oczekiwanie na pierwsze kwotowanie.',
  overflow: 'Wynik przekracza obsługiwany zakres liczbowy.',
};

export const priceReasonLabel: Record<PriceUnavailableReason, string> = {
  'select-symbol': 'Wybierz symbol, aby pobrać bieżącą cenę.',
  'missing-contract': 'Brak wartości kontraktu dla wybranego symbolu.',
  disconnected: 'Brak połączenia z kwotowaniami. Poczekaj na ponowne połączenie.',
  'awaiting-quote': 'Oczekiwanie na świeże kwotowanie wybranego symbolu.',
  'invalid-price': 'Bieżąca cena musi być większa od zera.',
};

export const addOrderErrorLabel: Record<AddOrderError, string> = {
  'legacy-pending': 'Najpierw sprawdź wynik zachowanego zlecenia z poprzedniej wersji.',
  'operation-not-found':
    'Nie znaleziono zakończonej operacji. Zlecenie mogło być jeszcze w toku. Zachowano jego dane; sprawdź wynik ponownie lub skontaktuj się z administratorem.',
  'idempotency-conflict':
    'Klucz zapisu został już użyty z innymi danymi. Sprawdź zlecenia przed kolejną próbą.',
  'invalid-input': 'Sprawdź symbol, stronę i dodatni wolumen.',
  'missing-contract': 'Brak wartości kontraktu dla wybranego symbolu.',
  'stale-quote': 'Dodanie wymaga świeżego kwotowania. Poczekaj na bieżącą cenę.',
  saving: 'Trwa zapisywanie zlecenia.',
  'unknown-symbol': 'Wybrany instrument nie istnieje. Odśwież dane i spróbuj ponownie.',
  'save-failed':
    'Nie udało się potwierdzić zapisu zlecenia. Ponów próbę, aby sprawdzić wynik bez powielania zlecenia.',
};
