import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService, InterpolationOptions } from './i18n.service';

/**
 * I18nPipe translates text keys in templates.
 *
 * Usage:
 * {{ 'send_bitcoin' | i18n }}
 * {{ 'welcome_message' | i18n:{ name: userName } }}
 *
 * Note: This is an impure pipe to react to language changes.
 * For performance-critical lists, consider using the service directly.
 */
@Pipe({
  name: 'i18n',
  standalone: true,
  pure: false, // Impure to react to language changes
})
export class I18nPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: string, options?: InterpolationOptions): string {
    return this.i18n.get(key, options);
  }
}
