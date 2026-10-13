import { TestBed } from '@angular/core/testing';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  it('limits messages, dismisses them and clears timers on destroy', () => {
    vi.useFakeTimers();
    try {
      TestBed.configureTestingModule({ providers: [NotificationService] });
      const notifications = TestBed.inject(NotificationService);
      for (let index = 0; index < 6; index++) notifications.notify(String(index));
      expect(notifications.messages().map(({ message }) => message)).toEqual([
        '1',
        '2',
        '3',
        '4',
        '5',
      ]);
      expect(vi.getTimerCount()).toBe(5);
      notifications.dismiss(notifications.messages()[0].id);
      expect(vi.getTimerCount()).toBe(4);
      TestBed.resetTestingModule();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
