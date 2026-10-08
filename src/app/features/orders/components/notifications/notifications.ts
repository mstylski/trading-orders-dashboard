import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface Notification {
  readonly id: number;
  readonly message: string;
}

@Component({
  selector: 'app-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notifications.html',
  styleUrl: './notifications.scss',
})
export class Notifications {
  readonly messages = input.required<readonly Notification[]>();
  readonly dismiss = output<number>();
}
