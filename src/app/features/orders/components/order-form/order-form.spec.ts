import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OrderForm } from './order-form';

describe('OrderForm', () => {
  let fixture: ComponentFixture<OrderForm>;
  let element: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T12:34:56.789'));
    fixture = TestBed.createComponent(OrderForm);
    fixture.componentRef.setInput('symbols', ['BTCUSD', 'EURUSD']);
    fixture.componentRef.setInput('price', 110);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });
  afterEach(() => vi.useRealTimers());

  function fill(): void {
    fixture.componentInstance.form().value.set({
      symbol: 'BTCUSD',
      side: 'BUY',
      size: '0.05',
    });
    fixture.detectChanges();
  }

  it('has no client-controlled opening time', () => {
    expect(element.querySelector('#order-time')).toBeNull();
    expect(fixture.componentInstance.form().value()).not.toHaveProperty('openTime');
  });

  it('emits only editable fields after the form has been open', async () => {
    fill();
    const submit = vi.fn();
    fixture.componentInstance.submitted.subscribe(submit);
    vi.setSystemTime(new Date('2026-11-16T12:40:12.345'));
    fixture.detectChanges();
    const button = element.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(button.disabled).toBe(false);
    button.click();
    await fixture.whenStable();
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSD',
      side: 'BUY',
      size: 0.05,
    });
  });

  it('restores an uncertain attempt and retries its original price without fresh quotes', async () => {
    const order = {
      symbol: 'BTCUSD',
      side: 'SELL' as const,
      size: 0.125,
      openPrice: 67250.25,
    };
    fixture.componentRef.setInput('initialOrder', order);
    fixture.componentRef.setInput('retryOrder', order);
    vi.setSystemTime(new Date('2030-01-01T01:02:03.456'));
    fixture.componentRef.setInput('price', 68250.25);
    fixture.componentRef.setInput('unavailableReason', 'Oczekiwanie na świeże kwotowanie.');
    fixture.detectChanges();
    expect(element.querySelector<HTMLInputElement>('#order-size')!.value).toBe('0,125');
    expect(element.querySelector<HTMLInputElement>('#order-price')!.value).toContain('67');
    expect(element.textContent).toContain('Ponowienie użyje danych i ceny z pierwszej próby.');
    for (const id of ['order-symbol', 'order-side', 'order-size']) {
      expect(element.querySelector<HTMLInputElement>(`#${id}`)!.disabled).toBe(true);
    }
    expect(element.querySelector<HTMLButtonElement>('[data-testid=retry-order]')!.disabled).toBe(
      false,
    );
    const submit = vi.fn();
    fixture.componentInstance.submitted.subscribe(submit);
    element.querySelector<HTMLButtonElement>('[data-testid=retry-order]')!.click();
    await fixture.whenStable();
    expect(submit).toHaveBeenCalledWith({
      symbol: order.symbol,
      side: order.side,
      size: order.size,
    });
    expect(element.querySelector('#order-time')).toBeNull();
  });

  it.each([
    [0.0000001, '0,0000001'],
    [0.125, '0,125'],
    [1e21, '1000000000000000000000'],
  ])(
    'restores and retries volume %s without fresh quotes or editable-field validation',
    async (size, formatted) => {
      const order = {
        symbol: 'BTCUSD',
        side: 'BUY' as const,
        size: size as number,
        openPrice: 67250.25,
      };
      fixture.componentRef.setInput('retryOrder', order);
      fixture.componentRef.setInput('price', null);
      fixture.componentRef.setInput('unavailableReason', 'Brak połączenia.');
      fixture.detectChanges();
      expect(element.querySelector<HTMLInputElement>('#order-size')!.value).toBe(formatted);
      const submit = vi.fn();
      fixture.componentInstance.submitted.subscribe(submit);
      // Even changes outside the disabled UI cannot alter the retry snapshot.
      fixture.componentInstance.form.size().value.set('invalid');
      fixture.detectChanges();
      const retry = element.querySelector<HTMLButtonElement>('[data-testid=retry-order]')!;
      expect(retry.disabled).toBe(false);
      retry.click();
      await fixture.whenStable();
      expect(submit).toHaveBeenCalledWith({
        symbol: order.symbol,
        side: order.side,
        size,
      });
    },
  );

  it('retains attempted fields for editing after a definitive rejection clears pending', () => {
    const order = {
      symbol: 'BTCUSD',
      side: 'SELL' as const,
      size: 0.125,
      openPrice: 110,
    };
    fixture.componentRef.setInput('retryOrder', order);
    fixture.detectChanges();
    fixture.componentRef.setInput('retryOrder', null);
    fixture.detectChanges();
    expect(fixture.componentInstance.form().value()).toEqual({
      symbol: order.symbol,
      side: order.side,
      size: '0,125',
    });
    expect(element.querySelector('#order-time')).toBeNull();
    expect(element.querySelector<HTMLInputElement>('#order-size')!.disabled).toBe(false);
    expect(element.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
  });

  it('requires symbol and positive finite size', () => {
    expect(fixture.componentInstance.form().invalid()).toBe(true);
    fill();
    expect(fixture.componentInstance.form().valid()).toBe(true);
    for (const size of ['0', '-1', 'Infinity', 'NaN', 'e333']) {
      fixture.componentInstance.form.size().value.set(size);
      expect(fixture.componentInstance.form().invalid()).toBe(true);
    }
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

  it('blocks a repeated submission and cancellation while saving', async () => {
    fill();
    fixture.componentRef.setInput('saving', true);
    fixture.detectChanges();
    const submit = vi.fn();
    const cancel = vi.fn();
    fixture.componentInstance.submitted.subscribe(submit);
    fixture.componentInstance.cancelled.subscribe(cancel);
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    element.querySelector<HTMLButtonElement>('[data-testid=cancel-order]')!.click();
    await fixture.whenStable();
    expect(element.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    expect(element.textContent).toContain('Zapisywanie…');
    expect(submit).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
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
    });
  });
});
