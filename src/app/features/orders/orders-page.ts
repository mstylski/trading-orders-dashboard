import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  linkedSignal,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { OrdersStore } from './state/orders.store';
import { QuotesService } from './data/quotes.service';
import { OrdersTable } from './components/orders-table/orders-table';
import { OrderForm } from './components/order-form/order-form';
import { NewOrder, OrderGroup } from './models/order.models';
import { ThemeSwitcher } from '../../shared/ui/theme-switcher/theme-switcher';
import { Notifications } from '../../shared/ui/notifications/notifications';
import { NotificationService } from '../../shared/notifications/notification.service';
import { addOrderErrorLabel, priceReasonLabel } from './components/order-labels';

@Component({
  selector: 'app-orders-page',
  providers: [OrdersStore, QuotesService, NotificationService],
  imports: [OrdersTable, OrderForm, ThemeSwitcher, Notifications],
  templateUrl: './orders-page.html',
  styleUrl: './orders-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdersPage implements OnInit {
  protected readonly store = inject(OrdersStore);
  protected readonly formOpen = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly notifications = inject(NotificationService);
  protected readonly expanded = linkedSignal<readonly OrderGroup[], ReadonlySet<string>>({
    source: this.store.groups,
    computation: (groups, previous) => {
      const existing = new Set(groups.map((group) => group.symbol));
      return new Set([...(previous?.value ?? [])].filter((symbol) => existing.has(symbol)));
    },
  });
  protected readonly priceReasonLabel = priceReasonLabel;
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addButton');

  ngOnInit(): void {
    this.store.load();
  }

  protected openForm(): void {
    this.formError.set(null);
    this.formOpen.set(true);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
    this.formError.set(null);
    this.store.selectFormSymbol(null);
    this.addButton()?.nativeElement.focus();
  }

  protected selectSymbol(symbol: string): void {
    this.formError.set(null);
    this.store.selectFormSymbol(symbol);
  }

  protected addOrder(input: NewOrder): void {
    const result = this.store.addOrder(input);
    if ('error' in result) {
      this.formError.set(addOrderErrorLabel[result.error]);
      return;
    }
    this.expanded.update((expanded) => new Set([...expanded, result.order.symbol]));
    this.notifications.notify(`Dodano zlecenie nr ${result.order.id}`);
    this.closeForm();
  }

  protected closeOrder(id: number): void {
    this.notifyClosed(this.store.closeOrder(id));
  }
  protected closeGroup(symbol: string): void {
    this.notifyClosed(this.store.closeGroup(symbol));
  }

  protected toggleGroup(symbol: string): void {
    this.expanded.update((expanded) => {
      const next = new Set(expanded);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }

  private notifyClosed(ids: readonly number[]): void {
    if (ids.length) this.notifications.notify(`Zamknięto zlecenie nr ${ids.join(', ')}`);
  }
}
