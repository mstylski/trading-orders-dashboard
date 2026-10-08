import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { form, FormField, FormRoot, required, validate } from '@angular/forms/signals';
import { DecimalPipe } from '@angular/common';
import { NewOrder, OrderSide } from '../../models/order.models';
import { localDateTime, parseLocalDateTime } from './order-form.helpers';

interface OrderFormModel {
  symbol: string;
  side: OrderSide;
  size: string;
  openTime: string;
}

const volumePattern = /^\d+(?:[.,]\d+)?$/;

function parseVolume(value: string): number | null {
  if (!volumePattern.test(value)) return null;
  const volume = Number(value.replace(',', '.'));
  return Number.isFinite(volume) && volume > 0 ? volume : null;
}

@Component({
  selector: 'app-order-form',
  imports: [FormField, FormRoot, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-form.html',
  styleUrl: './order-form.scss',
})
export class OrderForm {
  readonly symbols = input.required<readonly string[]>();
  readonly price = input<number | null>(null);
  readonly unavailableReason = input<string | null>(null);
  readonly submitError = input<string | null>(null);
  readonly symbolChange = output<string>();
  readonly submitted = output<NewOrder>();
  readonly cancelled = output<void>();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly model = signal<OrderFormModel>({
    symbol: '',
    side: 'BUY',
    size: '',
    openTime: localDateTime(new Date()),
  });

  readonly form = form(
    this.model,
    (path) => {
      required(path.symbol, { message: 'Wybierz symbol.' });
      validate(path.symbol, ({ value }) =>
        !value() || this.symbols().includes(value())
          ? null
          : { kind: 'symbol', message: 'Wybierz dostępny symbol.' },
      );
      required(path.side, { message: 'Wybierz stronę zlecenia.' });
      validate(path.side, ({ value }) =>
        value() === 'BUY' || value() === 'SELL'
          ? null
          : { kind: 'side', message: 'Wybierz BUY lub SELL.' },
      );
      required(path.size, { message: 'Podaj wolumen.' });
      validate(path.size, ({ value }) =>
        !value() || volumePattern.test(value())
          ? null
          : { kind: 'pattern', message: 'Podaj wolumen w postaci liczby, np. 0,05.' },
      );
      validate(path.size, ({ value }) => {
        const size = value();
        return !size || !volumePattern.test(size) || parseVolume(size) !== null
          ? null
          : { kind: 'positive', message: 'Podaj wolumen większy od zera.' };
      });
      required(path.openTime, { message: 'Podaj datę i czas.' });
      validate(path.openTime, ({ value }) =>
        !value() || parseLocalDateTime(value()) !== null
          ? null
          : { kind: 'date', message: 'Podaj poprawną datę i czas.' },
      );
      validate(path, () => {
        const reason = this.unavailableReason();
        const price = this.price();
        return reason || price === null || !Number.isFinite(price) || price <= 0
          ? { kind: 'quote', message: reason ?? 'Oczekiwanie na poprawną bieżącą cenę.' }
          : null;
      });
    },
    {
      submission: {
        action: async () => {
          const value = this.model();
          const openTime = parseLocalDateTime(value.openTime);
          const size = parseVolume(value.size);
          if (size !== null && openTime !== null) {
            this.submitted.emit({
              symbol: value.symbol,
              side: value.side,
              size,
              openTime,
            });
          }
        },
      },
    },
  );

  constructor() {
    effect(() => {
      const symbol = this.form.symbol().value();
      untracked(() => this.symbolChange.emit(symbol));
    });
  }
}
