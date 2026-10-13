import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { form, FormField, FormRoot, required, validate } from '@angular/forms/signals';
import { DecimalPipe } from '@angular/common';
import { NewOrder, OrderSide } from '../../models/order.models';
import { localDateTime, parseLocalDateTime, parseVolume, volumeError } from './order-form.helpers';

interface OrderFormModel {
  symbol: string;
  side: OrderSide;
  size: string;
  openTime: string;
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
      validate(path.size, ({ value }) => volumeError(value()));
      required(path.openTime, { message: 'Podaj datę i czas.' });
      validate(path.openTime, ({ value }) =>
        !value() || parseLocalDateTime(value()) !== null
          ? null
          : { kind: 'date', message: 'Podaj poprawną datę i czas.' },
      );
    },
    {
      submission: {
        action: async () => {
          const price = this.price();
          if (this.unavailableReason() || price === null || !Number.isFinite(price) || price <= 0)
            return;
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

  onSymbolChange(event: Event): void {
    const symbol = (event.target as HTMLSelectElement).value;
    this.form.symbol().value.set(symbol);
    this.symbolChange.emit(symbol);
  }
}
