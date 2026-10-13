import { DestroyRef, inject, Injectable, signal } from '@angular/core';

export interface ToastMessage {
  readonly id: number;
  readonly message: string;
}

const MAX_VISIBLE_NOTIFICATIONS = 5;
const NOTIFICATION_TTL_MS = 4_000;

@Injectable()
export class NotificationService {
  private readonly state = signal<readonly ToastMessage[]>([]);
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextId = 1;
  readonly messages = this.state.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
    });
  }

  notify(message: string): void {
    const current = this.messages();
    if (current.length >= MAX_VISIBLE_NOTIFICATIONS) this.dismiss(current[0].id);
    const id = this.nextId++;
    this.state.update((messages) => [...messages, { id, message }]);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), NOTIFICATION_TTL_MS),
    );
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
    this.state.update((messages) => messages.filter((message) => message.id !== id));
  }
}
