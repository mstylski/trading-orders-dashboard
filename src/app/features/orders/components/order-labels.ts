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
  'invalid-input': 'Sprawdź symbol, stronę, dodatni wolumen i czas otwarcia.',
  'missing-contract': 'Brak wartości kontraktu dla wybranego symbolu.',
  'stale-quote': 'Dodanie wymaga świeżego kwotowania. Poczekaj na bieżącą cenę.',
  'id-exhausted': 'Wyczerpano zakres numerów zleceń.',
};
