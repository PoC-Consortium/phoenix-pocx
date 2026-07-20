import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { HashTruncatePipe } from '../../../../shared/pipes';
import { FitRowsDirective } from '../../../../shared/directives';
import {
  ClipboardService,
  Contact,
  ContactsStoreService,
  NotificationService,
} from '../../../../shared/services';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { validatePocxAddress } from '../../../../bitcoin/utils/address-validation';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';
import { PageHeaderComponent } from '../../components/page-header/page-header.component';

/**
 * WalletContactsComponent - the mobile address book.
 *
 * A slim surface over the SAME `wallet_contacts` store the desktop
 * contacts page uses (via ContactsStoreService): list / add / edit /
 * delete, filtered to the wallet's active network. Rows offer copy,
 * send-to and edit/delete; the send page's contact picker reads the
 * same store.
 */
@Component({
  selector: 'app-wallet-contacts',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDialogModule,
    MatMenuModule,
    MatPaginatorModule,
    MatTooltipModule,
    HashTruncatePipe,
    I18nPipe,
    FitRowsDirective,
    PageHeaderComponent,
  ],
  template: `
    <app-mwallet-page-header titleKey="contacts">
      <button mat-icon-button (click)="startAdd()" [matTooltip]="'add_contact' | i18n">
        <mat-icon>person_add</mat-icon>
      </button>
    </app-mwallet-page-header>

    <div class="page">
      <!-- Add / edit form -->
      @if (formOpen()) {
        <div class="card">
          <h3>{{ (editing() ? 'edit_contact' : 'add_contact') | i18n }}</h3>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>{{ 'contact_name' | i18n }}</mat-label>
            <input matInput [(ngModel)]="formName" autocomplete="off" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>{{ 'address' | i18n }}</mat-label>
            <input
              matInput
              [(ngModel)]="formAddress"
              (ngModelChange)="validateAddress()"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
            />
            @if (addressValid()) {
              <mat-icon matSuffix class="suffix-valid">check_circle</mat-icon>
            }
          </mat-form-field>
          @let addrErr = addressError();
          @if (addrErr) {
            <p class="error-text">{{ addrErr.key | i18n: addrErr.params }}</p>
          }

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>{{ 'notes_optional' | i18n }}</mat-label>
            <input matInput [(ngModel)]="formNotes" autocomplete="off" />
          </mat-form-field>

          <div class="button-row">
            <button mat-stroked-button (click)="closeForm()">
              {{ 'cancel' | i18n }}
            </button>
            <button
              mat-raised-button
              color="primary"
              [disabled]="!canSave()"
              (click)="saveContact()"
            >
              {{ 'save' | i18n }}
            </button>
          </div>
        </div>
      }

      <!-- List -->
      <div class="card list-card">
        @if (contacts().length === 0) {
          <div class="empty-state">
            <mat-icon>contacts</mat-icon>
            <span>{{ 'no_contacts' | i18n }}</span>
          </div>
        } @else {
          <!-- Fit-derived pagination (same idiom as the transactions page):
               the list flex-fills the card and FitRowsDirective measures how
               many contact rows fit — that fit IS the page size, so there is
               no items-per-page selector. -->
          <div
            class="contact-list"
            appFitRows
            [fitRowSelector]="'.contact-item'"
            [fitMinRows]="3"
            [fitFallbackRowPx]="56"
            (fitRows)="onFitRows($event)"
          >
            @for (contact of visibleContacts(); track contact.id) {
            <div class="contact-item">
              <div class="contact-main" (click)="copyAddress(contact)">
                <span class="contact-name">{{ contact.name }}</span>
                <span class="contact-address mono">
                  {{ contact.address | hashTruncate: 14 : 8 }}
                </span>
                @if (contact.notes) {
                  <span class="contact-notes">{{ contact.notes }}</span>
                }
              </div>
              <button mat-icon-button class="row-menu-button" [matMenuTriggerFor]="contactMenu">
                <mat-icon>more_vert</mat-icon>
              </button>
              <mat-menu #contactMenu="matMenu">
                <button mat-menu-item (click)="sendTo(contact)">
                  <mat-icon>send</mat-icon>
                  <span>{{ 'send_to_contact' | i18n }}</span>
                </button>
                <button mat-menu-item (click)="copyAddress(contact)">
                  <mat-icon>content_copy</mat-icon>
                  <span>{{ 'copy_address' | i18n }}</span>
                </button>
                <button mat-menu-item (click)="startEdit(contact)">
                  <mat-icon>edit</mat-icon>
                  <span>{{ 'edit' | i18n }}</span>
                </button>
                <button mat-menu-item (click)="deleteContact(contact)">
                  <mat-icon>delete</mat-icon>
                  <span>{{ 'delete' | i18n }}</span>
                </button>
              </mat-menu>
            </div>
            }
          </div>

          @if (contacts().length > pageSize()) {
            <mat-paginator
              [length]="contacts().length"
              [pageSize]="pageSize()"
              [pageIndex]="pageIndex()"
              [hidePageSize]="true"
              (page)="onPageChange($event)"
              [showFirstLastButtons]="true"
            ></mat-paginator>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      /* Fill the wallet-content column so the list card can flex into the
         leftover viewport height (same fill idiom as the transactions page),
         giving the contact list a measurable height for fit-based pagination. */
      :host {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .page {
        padding: 16px;
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        gap: 16px;
        max-width: 480px;
        width: 100%;
        margin: 0 auto;
        box-sizing: border-box;
      }

      .card {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 20px;

        h3 {
          margin: 0 0 12px;
          font-size: 15px;
          font-weight: 500;
        }
      }

      /* Flex-fill: basis 0 so the card's height comes from the leftover
         viewport space (never from its own rows); the min-height floor keeps
         ~3 rows readable on tiny viewports (the page then scrolls slightly). */
      .list-card {
        padding: 4px 0 0;
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 200px;
        overflow: hidden;
      }

      /* The measured row viewport: exactly the space between card top and
         paginator (basis 0: its height never depends on its own rows). */
      .contact-list {
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
      }

      /* Compact paginator (the transactions-page pager, mobile-sized). */
      mat-paginator {
        border-radius: 0 0 8px 8px;
        flex-shrink: 0;

        ::ng-deep .mat-mdc-paginator-container {
          min-height: 44px;
          padding: 0 4px;
          justify-content: center;
        }

        ::ng-deep .mat-mdc-paginator-range-label {
          font-size: 11px;
          margin: 0 6px;
        }

        ::ng-deep .mat-mdc-icon-button.mat-mdc-paginator-navigation-first,
        ::ng-deep .mat-mdc-icon-button.mat-mdc-paginator-navigation-previous,
        ::ng-deep .mat-mdc-icon-button.mat-mdc-paginator-navigation-next,
        ::ng-deep .mat-mdc-icon-button.mat-mdc-paginator-navigation-last {
          width: 36px;
          height: 36px;
          padding: 6px;
        }
      }

      .full-width {
        width: 100%;
      }

      .error-text {
        color: #c62828;
        font-size: 13px;
        margin: 0 0 12px;
      }

      .suffix-valid {
        color: #4caf50;
      }

      .button-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-top: 4px;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 32px 0;
        color: rgba(0, 0, 0, 0.38);

        mat-icon {
          font-size: 40px;
          width: 40px;
          height: 40px;
          margin-bottom: 8px;
        }

        span {
          font-size: 13px;
        }
      }

      .contact-item {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 8px 8px 8px 16px;

        &:not(:last-child) {
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        }
      }

      .contact-main {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        cursor: pointer;

        .contact-name {
          font-size: 14px;
          font-weight: 500;
        }

        .contact-address {
          font-size: 11px;
          color: rgba(0, 0, 0, 0.6);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .contact-notes {
          font-size: 11px;
          color: rgba(0, 0, 0, 0.45);
        }
      }

      .mono {
        font-family: monospace;
      }

      .row-menu-button {
        flex-shrink: 0;

        mat-icon {
          color: rgba(0, 0, 0, 0.45);
        }
      }

      :host-context(.dark-theme) {
        .card {
          background: #424242;
        }

        .empty-state {
          color: rgba(255, 255, 255, 0.38);
        }

        .contact-item:not(:last-child) {
          border-bottom-color: rgba(255, 255, 255, 0.08);
        }

        .contact-main {
          .contact-address {
            color: rgba(255, 255, 255, 0.6);
          }

          .contact-notes {
            color: rgba(255, 255, 255, 0.45);
          }
        }

        .row-menu-button mat-icon {
          color: rgba(255, 255, 255, 0.55);
        }
      }
    `,
  ],
})
export class WalletContactsComponent implements OnInit {
  readonly wallet = inject(BtcxWalletService);
  private readonly store = inject(ContactsStoreService);
  private readonly i18n = inject(I18nService);
  private readonly clipboard = inject(ClipboardService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly contacts = computed(() => this.store.forNetwork(this.wallet.network()));

  // Fit-derived pagination (mirrors the transactions page): the page size is
  // whatever FitRowsDirective measures fits the viewport (initial value only
  // covers the first paint before the directive's measurement lands).
  readonly pageSize = signal(8);
  readonly pageIndex = signal(0);

  /** The current page of contacts, clamped when the list shrinks. */
  readonly visibleContacts = computed(() => {
    const all = this.contacts();
    const size = this.pageSize();
    const maxPage = Math.max(0, Math.ceil(all.length / size) - 1);
    const page = Math.min(this.pageIndex(), maxPage);
    return all.slice(page * size, page * size + size);
  });

  readonly formOpen = signal(false);
  readonly editing = signal<Contact | null>(null);
  readonly addressValid = signal(false);
  readonly addressError = signal<{ key: string; params?: Record<string, string> } | null>(null);

  formName = '';
  formAddress = '';
  formNotes = '';

  ngOnInit(): void {
    void this.wallet.initialize();
    // Pick up edits made on other surfaces (desktop contacts page).
    this.store.load();

    // Add-mode entry (tx-row menu's "add to contact"): open the add form
    // with the handed-over address prefilled and validated.
    const address = this.route.snapshot.queryParamMap.get('add');
    if (address) {
      this.startAdd();
      this.formAddress = address;
      this.validateAddress();
      // Drop the param so back/refresh does not reopen the form.
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
  }

  startAdd(): void {
    this.editing.set(null);
    this.formName = '';
    this.formAddress = '';
    this.formNotes = '';
    this.addressValid.set(false);
    this.addressError.set(null);
    this.formOpen.set(true);
  }

  startEdit(contact: Contact): void {
    this.editing.set(contact);
    this.formName = contact.name;
    this.formAddress = contact.address;
    this.formNotes = contact.notes ?? '';
    this.formOpen.set(true);
    this.validateAddress();
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editing.set(null);
  }

  validateAddress(): void {
    this.addressValid.set(false);
    const result = validatePocxAddress(this.formAddress);
    switch (result.kind) {
      case 'empty':
        this.addressError.set(null);
        break;
      case 'invalid_format':
        this.addressError.set({ key: 'address_invalid_format' });
        break;
      case 'invalid_checksum':
        this.addressError.set({ key: 'address_invalid_checksum' });
        break;
      case 'valid':
        if (result.network !== this.wallet.network()) {
          this.addressError.set({
            key: 'address_wrong_network',
            params: {
              addressNetwork: this.i18n.get(result.network),
              appNetwork: this.i18n.get(this.wallet.network()),
            },
          });
        } else {
          this.addressError.set(null);
          this.addressValid.set(true);
        }
        break;
    }
  }

  canSave(): boolean {
    return this.formName.trim().length > 0 && this.addressValid();
  }

  saveContact(): void {
    if (!this.canSave()) return;
    const network = this.wallet.network();
    const editing = this.editing();
    if (this.store.hasAddress(network, this.formAddress, editing?.id)) {
      this.notifications.error(this.i18n.get('contact_address_exists'));
      return;
    }
    if (editing) {
      this.store.update(editing.id, this.formName, this.formAddress, this.formNotes);
      this.notifications.success(this.i18n.get('contact_updated'));
    } else {
      this.store.add(network, this.formName, this.formAddress, this.formNotes);
      this.notifications.success(this.i18n.get('contact_added'));
    }
    this.closeForm();
  }

  deleteContact(contact: Contact): void {
    const data: ConfirmDialogData = {
      title: this.i18n.get('delete_contact_title'),
      message: this.i18n.get('delete_contact_confirm', { name: contact.name }),
      confirmText: this.i18n.get('delete'),
      cancelText: this.i18n.get('cancel'),
      type: 'danger',
    };
    this.dialog
      .open(ConfirmDialogComponent, { data })
      .afterClosed()
      .subscribe((confirmed: boolean) => {
        if (!confirmed) return;
        this.store.remove(contact.id);
        this.notifications.success(this.i18n.get('contact_deleted'));
      });
  }

  sendTo(contact: Contact): void {
    void this.router.navigate(['/wallet/send'], {
      queryParams: { address: contact.address },
    });
  }

  /**
   * New measured fit (rotation, resize, first measurement): adopt it as the
   * page size and keep the user on the page containing the previously first
   * visible contact instead of resetting to page 0.
   */
  onFitRows(fit: number): void {
    const oldSize = this.pageSize();
    if (fit === oldSize) return;
    const firstVisibleIndex = this.pageIndex() * oldSize;
    this.pageSize.set(fit);
    this.pageIndex.set(Math.floor(firstVisibleIndex / fit));
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
  }

  async copyAddress(contact: Contact): Promise<void> {
    await this.clipboard.copyAddress(contact.address);
  }
}
