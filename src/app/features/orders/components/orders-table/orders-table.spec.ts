import { TestBed } from '@angular/core/testing';
import { OrdersTable } from './orders-table';
import { buildContractSizes, groupOrders } from '../../domain/orders';
import { testData, testQuote } from '../../testing/fixtures';

describe('OrdersTable', () => {
  it('does not toggle a group when its close button is pressed', () => {
    const fixture = TestBed.createComponent(OrdersTable);
    fixture.componentRef.setInput('groups', groupOrders(testData.orders, new Map(), new Map()));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const closed = vi.fn();
    fixture.componentInstance.closeGroup.subscribe(closed);
    element.querySelector<HTMLButtonElement>('.group-row .close-button')!.click();
    fixture.detectChanges();
    expect(closed).toHaveBeenCalledWith('BTCUSD');
    expect(element.querySelector('.group-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(element.querySelectorAll('.order-row')).toHaveLength(0);
  });

  it('formats dates in local time and shows a neutral zero profit', () => {
    const fixture = TestBed.createComponent(OrdersTable);
    const order = { ...testData.orders[0], openTime: new Date(2025, 5, 20, 18, 30, 22).getTime() };
    fixture.componentRef.setInput(
      'groups',
      groupOrders(
        [order],
        new Map([['BTCUSD', testQuote('BTCUSD', 100)]]),
        buildContractSizes(testData.instruments, testData.contracts),
      ),
    );
    fixture.detectChanges();
    fixture.componentInstance.expand('BTCUSD');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.date')?.textContent).toBe('20.06.2025 18:30:22');
    expect(element.querySelector('.profit')?.className).not.toContain('positive');
    expect(element.querySelector('.profit')?.className).not.toContain('negative');
  });
});
