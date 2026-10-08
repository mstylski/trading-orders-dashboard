import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { OrdersStore } from './state/orders.store';
import { QuotesService } from './data/quotes.service';
import { OrdersTable } from './components/orders-table/orders-table';
import { OrderForm } from './components/order-form/order-form';
import { NewOrder, Order } from './models/order.models';
import { ThemeSwitcher } from './components/theme-switcher/theme-switcher';
import { Notification, Notifications } from './components/notifications/notifications';

@Component({
  selector: 'app-orders-page',
  providers: [OrdersStore, QuotesService],
  imports: [OrdersTable, OrderForm, ThemeSwitcher, Notifications],
  templateUrl: './orders-page.html',
  styleUrl: './orders-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdersPage implements OnInit, OnDestroy {
  protected readonly store = inject(OrdersStore);
  protected readonly formOpen = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly notifications = signal<readonly Notification[]>([]);
  protected readonly newlyAdded = signal<Order | null>(null);
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addButton');
  private readonly notificationTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextNotificationId = 1;

  ngOnInit(): void {
    this.store.load();
  }

  ngOnDestroy(): void {
    for (const timer of this.notificationTimers.values()) clearTimeout(timer);
    this.notificationTimers.clear();
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
      this.formError.set(result.error);
      return;
    }
    this.newlyAdded.set(result.order);
    this.notify(`Dodano zlecenie nr ${result.order.id}`);
    this.closeForm();
  }

  protected closeOrder(id: number): void {
    this.notifyClosed(this.store.closeOrder(id));
  }
  protected closeGroup(symbol: string): void {
    this.notifyClosed(this.store.closeGroup(symbol));
  }

  protected dismiss(id: number): void {
    const timer = this.notificationTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.notificationTimers.delete(id);
    this.notifications.update((messages) => messages.filter((message) => message.id !== id));
  }

  private notifyClosed(ids: readonly number[]): void {
    if (ids.length) this.notify(`Zamknięto zlecenie nr ${ids.join(', ')}`);
  }

  private notify(message: string): void {
    const current = this.notifications();
    if (current.length === 5) this.dismiss(current[0].id);
    const id = this.nextNotificationId++;
    this.notifications.update((messages) => [...messages, { id, message }]);
    this.notificationTimers.set(
      id,
      setTimeout(() => this.dismiss(id), 4_000),
    );
  }
}
