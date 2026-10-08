import { ComponentFixture, DeferBlockState, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OrdersPage } from './orders-page';
import { appConfig } from '../../app.config';
import { ORDERS_API } from './data/orders-api.service';
import { FakeSocket, testData } from './testing/fixtures';

describe('Dashboard integration', () => {
  let fixture: ComponentFixture<OrdersPage>;
  let element: HTMLElement;
  let http: HttpTestingController;
  let socket: FakeSocket;
  beforeEach(() => {
    socket = new FakeSocket();
    vi.stubGlobal('WebSocket', function () {
      return socket;
    });
    TestBed.configureTestingModule({
      imports: [OrdersPage],
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
      ],
    });
    fixture = TestBed.createComponent(OrdersPage);
    element = fixture.nativeElement as HTMLElement;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
  });

  async function load(): Promise<void> {
    http.expectOne(`${ORDERS_API}/order-data.json`).flush({ data: testData.orders });
    http.expectOne(`${ORDERS_API}/instruments.json`).flush(testData.instruments);
    http.expectOne(`${ORDERS_API}/contract-types.json`).flush(testData.contracts);
    socket.open();
    socket.quote();
    socket.quote('EURUSD', 1.1);
    await fixture.whenStable();
  }

  async function click(selector: string): Promise<void> {
    const button = element.querySelector<HTMLButtonElement>(selector);
    expect(button, selector).not.toBeNull();
    button!.click();
    await fixture.whenStable();
  }

  async function fill(selector: string, value: string): Promise<void> {
    const control = element.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  }

  async function openForm(): Promise<void> {
    await click('.add-button');
    const blocks = await fixture.getDeferBlocks();
    expect(blocks).toHaveLength(1);
    await blocks[0].render(DeferBlockState.Complete);
    await fixture.whenStable();
  }

  it('shows loading, then collapsed groups and preserves multiple expanded groups across ticks', async () => {
    expect(element.textContent).toContain('Ładowanie zleceń');
    await load();
    expect(element.querySelector('h1')?.textContent).toBe('Otwarte zlecenia');
    expect(element.querySelectorAll('.group-row')).toHaveLength(2);
    expect(element.querySelectorAll('.order-row')).toHaveLength(0);
    await click('[aria-label="Rozwiń grupę BTCUSD"]');
    await click('[aria-label="Rozwiń grupę EURUSD"]');
    expect(element.querySelectorAll('.order-row')).toHaveLength(3);
    const row = element.querySelector('.order-row');
    socket.quote('BTCUSD', 111);
    await fixture.whenStable();
    expect(element.querySelectorAll('.order-row')).toHaveLength(3);
    expect(element.querySelector('.order-row')).toBe(row);
    expect(socket.sent).toHaveLength(1);
  });

  it('closes a group and individual order with the exact notifications and empty state', async () => {
    await load();
    await click('[aria-label="Zamknij grupę BTCUSD"]');
    expect(element.querySelector('.notification p')?.textContent).toBe(
      'Zamknięto zlecenie nr 10, 20',
    );
    await click('[aria-label="Rozwiń grupę EURUSD"]');
    await click('[aria-label="Zamknij zlecenie nr 11"]');
    expect(element.textContent).toContain('Zamknięto zlecenie nr 11');
    expect(element.textContent).toContain('Brak otwartych zleceń');
    await click('[aria-label="Zamknij powiadomienie"]');
    expect(element.querySelectorAll('.notification')).toHaveLength(1);
  });

  it('dismisses each notification four seconds after it appears', async () => {
    await load();
    vi.useFakeTimers();
    try {
      element.querySelector<HTMLButtonElement>('[aria-label="Zamknij grupę BTCUSD"]')!.click();
      fixture.detectChanges();
      expect(element.querySelectorAll('.notification')).toHaveLength(1);

      vi.advanceTimersByTime(2_000);
      element.querySelector<HTMLButtonElement>('[aria-label="Zamknij grupę EURUSD"]')!.click();
      fixture.detectChanges();
      expect(element.querySelectorAll('.notification')).toHaveLength(2);

      vi.advanceTimersByTime(1_999);
      fixture.detectChanges();
      expect(element.querySelectorAll('.notification')).toHaveLength(2);

      vi.advanceTimersByTime(1);
      fixture.detectChanges();
      expect(element.querySelectorAll('.notification')).toHaveLength(1);
      expect(element.querySelector('.notification p')?.textContent).toBe(
        'Zamknięto zlecenie nr 11',
      );

      vi.advanceTimersByTime(2_000);
      fixture.detectChanges();
      expect(element.querySelectorAll('.notification')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels notification timers when dismissed or the page is destroyed', async () => {
    await load();
    vi.useFakeTimers();
    try {
      element.querySelector<HTMLButtonElement>('[aria-label="Zamknij grupę BTCUSD"]')!.click();
      fixture.detectChanges();
      expect(vi.getTimerCount()).toBe(1);

      element.querySelector<HTMLButtonElement>('[aria-label="Zamknij powiadomienie"]')!.click();
      fixture.detectChanges();
      expect(vi.getTimerCount()).toBe(0);

      element.querySelector<HTMLButtonElement>('[aria-label="Zamknij grupę EURUSD"]')!.click();
      fixture.detectChanges();
      expect(vi.getTimerCount()).toBe(1);
      fixture.destroy();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds through Signal Forms after all groups are closed and expands the recreated group', async () => {
    await load();
    await click('[aria-label="Zamknij grupę BTCUSD"]');
    await click('[aria-label="Zamknij grupę EURUSD"]');
    await openForm();
    expect(element.querySelectorAll('#order-symbol option')).toHaveLength(3);
    await fill('#order-symbol', 'BTCUSD');
    await fill('#order-size', '0.05');
    expect(element.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    socket.quote('BTCUSD', 115);
    await fixture.whenStable();
    expect(element.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
    await click('button[type=submit]');
    expect(element.querySelector('app-order-form')).toBeNull();
    expect(element.querySelector('.group-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelectorAll('.order-row')).toHaveLength(1);
    expect(element.querySelector('.order-id')?.textContent).toBe('21');
    expect(element.querySelector('.order-row')?.textContent).toContain('115');
    expect(element.textContent).toContain('Dodano zlecenie nr 21');
  });

  it('shows a recoverable HTTP error and successfully retries', async () => {
    const requests = http.match(() => true);
    requests[0].flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(element.textContent).toContain('Nie udało się załadować danych');
    await click('.state-panel button');
    await load();
    expect(element.querySelectorAll('.group-row')).toHaveLength(2);
  });

  it('cancels the form subscription when closing an unneeded symbol', async () => {
    await load();
    await click('[aria-label="Zamknij grupę BTCUSD"]');
    await openForm();
    await fill('#order-symbol', 'BTCUSD');
    expect(socket.sent.at(-1)).toEqual({ p: '/subscribe/addlist', d: ['BTCUSD'] });
    await click('[aria-label="Zamknij formularz"]');
    expect(socket.sent.at(-1)).toEqual({ p: '/subscribe/removelist', d: ['BTCUSD'] });
  });
});
