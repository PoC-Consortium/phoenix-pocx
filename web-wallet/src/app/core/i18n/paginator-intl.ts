import { Injectable, inject, OnDestroy } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { Subject, takeUntil } from 'rxjs';
import { I18nService } from './i18n.service';

/**
 * Custom MatPaginatorIntl that uses the I18nService for translations.
 * This ensures paginator labels are translated when the language changes.
 */
@Injectable()
export class CustomPaginatorIntl extends MatPaginatorIntl implements OnDestroy {
  private readonly i18n = inject(I18nService);
  private readonly destroy$ = new Subject<void>();

  constructor() {
    super();
    this.updateLabels();

    // Update labels when language changes
    this.i18n.languageChange$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.updateLabels();
      this.changes.next();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private updateLabels(): void {
    this.itemsPerPageLabel = this.i18n.get('items_per_page');
    this.nextPageLabel = this.i18n.get('next_page');
    this.previousPageLabel = this.i18n.get('previous_page');
    this.firstPageLabel = this.i18n.get('first_page');
    this.lastPageLabel = this.i18n.get('last_page');
  }

  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0) {
      return `0 ${this.i18n.get('of_label')} ${length}`;
    }
    const startIndex = page * pageSize;
    const endIndex = Math.min(startIndex + pageSize, length);
    return `${startIndex + 1} - ${endIndex} ${this.i18n.get('of_label')} ${length}`;
  };
}
