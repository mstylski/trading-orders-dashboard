import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ToastMessage } from '../../notifications/notification.service';

@Component({
  selector: 'app-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notifications.html',
  styleUrl: './notifications.scss',
})
export class Notifications {
  readonly messages = input.required<readonly ToastMessage[]>();
  readonly dismiss = output<number>();
}
