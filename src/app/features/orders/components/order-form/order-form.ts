import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { disabled, form, FormField, FormRoot, required, validate } from '@angular/forms/signals';
import { DecimalPipe } from '@angular/common';
import { CreateOrderRequest, NewOrder, OrderSide } from '../../models/order.models';
import { formatVolume, parseVolume, volumeError } from './order-form.helpers';

interface OrderFormModel {
  symbol: string;
  side: OrderSide;
  size: string;
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
  readonly saving = input(false);
  readonly initialOrder = input<NewOrder | null>(null);
  readonly retryOrder = input<CreateOrderRequest | null>(null);
  readonly symbolChange = output<string>();
  readonly submitted = output<NewOrder>();
  readonly cancelled = output<void>();

  private readonly model = linkedSignal<NewOrder | null, OrderFormModel>({
    source: () => this.retryOrder() ?? this.initialOrder(),
    computation: (order, previous) =>
      order
        ? {
            symbol: order.symbol,
            side: order.side,
            size: formatVolume(order.size),
          }
        : (previous?.value ?? {
            symbol: '',
            side: 'BUY',
            size: '',
          }),
  });

  protected readonly retrying = computed(() => this.retryOrder() !== null);
  protected readonly displayedPrice = computed(() =>
    this.retrying() ? this.retryOrder()!.openPrice : this.price(),
  );
  protected readonly quoteUnavailable = computed(
    () =>
      !this.retrying() &&
      (this.unavailableReason() !== null ||
        this.price() === null ||
        !Number.isFinite(this.price()) ||
        this.price()! <= 0),
  );

  readonly form = form(
    this.model,
    (path) => {
      disabled(path, { when: () => this.saving() || this.retrying() });
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
    },
    {
      submission: {
        action: async () => {
          if (this.retrying() || this.saving() || this.quoteUnavailable()) return;
          const value = this.model();
          const size = parseVolume(value.size);
          if (size !== null) {
            this.submitted.emit({
              symbol: value.symbol,
              side: value.side,
              size,
            });
          }
        },
      },
    },
  );

  onSymbolChange(event: Event): void {
    if (this.retrying() || this.saving()) return;
    const symbol = (event.target as HTMLSelectElement).value;
    this.form.symbol().value.set(symbol);
    this.symbolChange.emit(symbol);
  }

  protected retry(): void {
    const request = this.retryOrder();
    if (!request || this.saving()) return;
    this.submitted.emit({
      symbol: request.symbol,
      side: request.side,
      size: request.size,
    });
  }
}
