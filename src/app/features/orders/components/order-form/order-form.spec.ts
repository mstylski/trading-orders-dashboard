import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OrderForm } from './order-form';
import { localDateTime, parseLocalDateTime } from './order-form.helpers';

describe('OrderForm', () => {
  let fixture: ComponentFixture<OrderForm>;
  let element: HTMLElement;
  beforeEach(() => {
    fixture = TestBed.createComponent(OrderForm);
    fixture.componentRef.setInput('symbols', ['BTCUSD', 'EURUSD']);
    fixture.componentRef.setInput('price', 110);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  function fill(): void {
    fixture.componentInstance
      .form()
      .value.set({ symbol: 'BTCUSD', side: 'BUY', size: '0.05', openTime: '2025-06-20T18:30:22' });
    fixture.detectChanges();
  }

  it('requires symbol and positive finite size, and validates the local date', () => {
    expect(fixture.componentInstance.form().invalid()).toBe(true);
    fill();
    expect(fixture.componentInstance.form().valid()).toBe(true);
    for (const size of ['0', '-1', 'Infinity', 'NaN', 'e333']) {
      fixture.componentInstance.form.size().value.set(size);
      expect(fixture.componentInstance.form().invalid()).toBe(true);
    }
    expect(parseLocalDateTime('2025-02-30T12:00')).toBeNull();
    expect(parseLocalDateTime('invalid')).toBeNull();
    expect(localDateTime(new Date(2025, 5, 20, 18, 30, 22))).toBe('2025-06-20T18:30:22');
  });

  it('shows a format error for nonnumeric volume input', () => {
    const input = element.querySelector<HTMLInputElement>('#order-size')!;
    input.value = 'e333';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.form.size().value()).toBe('e333');
    expect(element.querySelector('#size-error')?.textContent).toContain(
      'Podaj wolumen w postaci liczby',
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(element.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  });

  it('accepts a decimal comma and emits a number', async () => {
    fill();
    fixture.componentInstance.form.size().value.set('0,05');
    fixture.detectChanges();
    expect(fixture.componentInstance.form().valid()).toBe(true);

    const submit = vi.fn();
    fixture.componentInstance.submitted.subscribe(submit);
    element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ size: 0.05 }));
  });

  it('notifies the page when the selected symbol changes', () => {
    const changed = vi.fn();
    fixture.componentInstance.symbolChange.subscribe(changed);
    const select = element.querySelector<HTMLSelectElement>('#order-symbol')!;
    select.value = 'EURUSD';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(changed).toHaveBeenCalledWith('EURUSD');
    fixture.componentInstance.form.symbol().value.set('UNKNOWN');
    expect(fixture.componentInstance.form.symbol().invalid()).toBe(true);
  });

  it('blocks submission without a fresh quote and explains the reason', async () => {
    fill();
    fixture.componentRef.setInput('unavailableReason', 'Oczekiwanie na świeże kwotowanie.');
    fixture.detectChanges();
    const submit = vi.fn();
    fixture.componentInstance.submitted.subscribe(submit);
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(element.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    expect(element.textContent).toContain('Oczekiwanie na świeże');
    expect(submit).not.toHaveBeenCalled();
  });

  it('shows a readonly live price and emits validated fields without caching the price', async () => {
    fill();
    const submit = vi.fn();
    fixture.componentInstance.submitted.subscribe(submit);
    fixture.componentRef.setInput('price', 115);
    fixture.detectChanges();
    expect(element.querySelector<HTMLInputElement>('#order-price')!.readOnly).toBe(true);
    expect(element.querySelector<HTMLInputElement>('#order-price')!.value).toBe('115');
    element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
    expect(submit).toHaveBeenCalledWith({
      symbol: 'BTCUSD',
      side: 'BUY',
      size: 0.05,
      openTime: new Date(2025, 5, 20, 18, 30, 22).getTime(),
    });
  });
});
