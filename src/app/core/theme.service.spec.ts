import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { THEME_STORAGE_KEY, ThemeService } from './theme.service';

describe('ThemeService', () => {
  let listener: ((event: { matches: boolean }) => void) | undefined;
  const removeListener = vi.fn();

  beforeEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    listener = undefined;
    removeListener.mockClear();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: (_name: string, fn: typeof listener) => (listener = fn),
        removeEventListener: removeListener,
      })),
    );
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    localStorage.removeItem(THEME_STORAGE_KEY);
    delete document.documentElement.dataset['theme'];
  });

  it('follows system changes by default and applies CSS theme attributes', () => {
    const theme = TestBed.inject(ThemeService);
    TestBed.tick();
    expect(theme.preference()).toBe('system');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    listener?.({ matches: false });
    TestBed.tick();
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('persists explicit choice, ignores system changes until system is restored, and cleans up', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const theme = TestBed.inject(ThemeService);
    expect(theme.resolved()).toBe('light');
    listener?.({ matches: true });
    expect(theme.resolved()).toBe('light');
    theme.setPreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    theme.setPreference('system');
    listener?.({ matches: false });
    expect(theme.resolved()).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    TestBed.resetTestingModule();
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it('still changes theme when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Unavailable');
    });
    const theme = TestBed.inject(ThemeService);
    expect(() => theme.setPreference('light')).not.toThrow();
    expect(theme.resolved()).toBe('light');
    spy.mockRestore();
  });

  it('does not access browser DOM or storage on the server', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: DOCUMENT, useValue: { defaultView: undefined } },
      ],
    });
    const theme = TestBed.inject(ThemeService);
    expect(() => TestBed.tick()).not.toThrow();
    expect(theme.resolved()).toBe('light');
    expect(() => theme.setPreference('dark')).not.toThrow();
  });
});
