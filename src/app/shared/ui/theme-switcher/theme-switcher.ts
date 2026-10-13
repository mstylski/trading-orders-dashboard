import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { isThemePreference, ThemeService } from '../../../core/theme.service';

@Component({
  selector: 'app-theme-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './theme-switcher.html',
  styleUrl: './theme-switcher.scss',
})
export class ThemeSwitcher {
  protected readonly theme = inject(ThemeService);

  protected changePreference(value: string): void {
    if (isThemePreference(value)) this.theme.setPreference(value);
  }
}
