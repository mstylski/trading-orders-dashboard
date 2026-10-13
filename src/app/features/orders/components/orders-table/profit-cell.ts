import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ProfitUnavailableReason } from '../../models/order.models';
import { profitReasonLabel } from '../order-labels';

@Component({
  // A component on the native td keeps table semantics and column layout intact.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'td[appProfitCell]',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profit-cell.html',
  host: {
    class: 'table-cell number profit',
    '[class.positive]': 'value() !== null && value()! > 0',
    '[class.negative]': 'value() !== null && value()! < 0',
    '[attr.title]': 'reason() ? profitReasonLabel[reason()!] : null',
  },
})
export class ProfitCell {
  readonly value = input.required<number | null>();
  readonly reason = input.required<ProfitUnavailableReason | null>();
  protected readonly profitReasonLabel = profitReasonLabel;
}
