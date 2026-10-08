import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_STORAGE_KEY = 'trading-orders-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;
  private readonly media = this.window?.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);
  private readonly preferenceState = signal<ThemePreference>(this.readPreference());
  readonly preference = this.preferenceState.asReadonly();
  readonly resolved = computed(() => this.preference() === 'system'
    ? this.systemDark() ? 'dark' : 'light'
    : this.preference());

  constructor() {
    const onChange = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
    this.media?.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.media?.removeEventListener('change', onChange));
    effect(() => this.document.documentElement.dataset['theme'] = this.resolved());
  }

  setPreference(value: string): void {
    if (value !== 'system' && value !== 'light' && value !== 'dark') return;
    this.preferenceState.set(value);
    try { this.window?.localStorage.setItem(THEME_STORAGE_KEY, value); } catch { /* Storage can be disabled. */ }
  }

  private readPreference(): ThemePreference {
    try {
      const value = this.window?.localStorage.getItem(THEME_STORAGE_KEY);
      if (value === 'light' || value === 'dark') return value;
    } catch { /* Fall back to the system preference. */ }
    return 'system';
  }
}
