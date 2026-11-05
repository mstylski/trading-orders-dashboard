import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { OrderGroup } from '../../models/order.models';
import { ProfitCell } from './profit-cell';

@Component({
  selector: 'app-orders-table',
  imports: [DatePipe, DecimalPipe, ProfitCell],
  templateUrl: './orders-table.html',
  styleUrl: './orders-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdersTable {
  readonly groups = input.required<readonly OrderGroup[]>();
  readonly quoteFreshness = input.required<ReadonlyMap<string, 'waiting' | 'current' | 'stale'>>();
  readonly expanded = input.required<ReadonlySet<string>>();
  readonly closeOrder = output<number>();
  readonly closeGroup = output<string>();
  readonly toggleGroup = output<string>();

  protected toggle(symbol: string): void {
    this.toggleGroup.emit(symbol);
  }

  protected closeSymbol(event: Event, symbol: string): void {
    event.stopPropagation();
    this.closeGroup.emit(symbol);
  }
}
