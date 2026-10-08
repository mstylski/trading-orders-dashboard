import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Order, OrderGroup } from '../../models/order.models';

@Component({
  selector: 'app-orders-table',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './orders-table.html',
  styleUrl: './orders-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdersTable {
  readonly groups = input.required<readonly OrderGroup[]>();
  readonly stale = input(false);
  readonly newlyAdded = input<Order | null>(null);
  readonly closeOrder = output<number>();
  readonly closeGroup = output<string>();
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());

  constructor() {
    effect(() => {
      const order = this.newlyAdded();
      if (order) untracked(() => this.expand(order.symbol));
    });
    effect(() => {
      const existing = new Set(this.groups().map((group) => group.symbol));
      untracked(() =>
        this.expanded.update(
          (expanded) => new Set([...expanded].filter((symbol) => existing.has(symbol))),
        ),
      );
    });
  }

  expand(symbol: string): void {
    this.expanded.update((expanded) => new Set([...expanded, symbol]));
  }

  protected toggle(symbol: string): void {
    this.expanded.update((expanded) => {
      const next = new Set(expanded);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }

  protected closeSymbol(event: Event, symbol: string): void {
    event.stopPropagation();
    this.closeGroup.emit(symbol);
  }
}
