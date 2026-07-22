import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import {
  ClipboardService,
  Contact,
  ContactsStoreService,
  NotificationService,
} from '../../../../shared/services';
import { FitRowsDirective } from '../../../../shared/directives';
import { validatePocxAddress } from '../../../../bitcoin/utils/address-validation';
import { selectNetwork } from '../../../../store/settings/settings.selectors';
import type { Network } from '../../../../store/settings/settings.state';
import { NodeService } from '../../../../node/services/node.service';
import { AppModeService } from '../../../../core/services/app-mode.service';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../../../shared/components/confirm-dialog/confirm-dialog.component';

/**
 * ContactListComponent — the ONE responsive address book, serving both the
 * desktop route (`/contacts`, main-layout) and the mobile-wallet route
 * (`/wallet/contacts`, mobile-wallet-layout). One template, one set of
 * styles: a flex "table" at wide widths that reflows to stacked cards below
 * the 600px breakpoint (like the mining dashboard — pure CSS `@media`, no
 * BreakpointObserver, no desktop/mobile fork).
 *
 * Features:
 * - Add / edit / delete contacts (inline expanding form-card)
 * - Search (name / address / notes)
 * - Fit-to-viewport pagination at ALL widths (FitRowsDirective measures how
 *   many rows fit; that fit IS the page size — no items-per-page selector)
 * - Copy address (inline button + per-row menu), send-to-contact
 *
 * Persistence is the shared ContactsStoreService (the `wallet_contacts`
 * localStorage book both shells read/write), so edits made on one surface
 * appear on the other after a `load()` on entry.
 */
@Component({
  selector: 'app-contact-list',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDividerModule,
    MatDialogModule,
    MatMenuModule,
    MatPaginatorModule,
    MatTooltipModule,
    FitRowsDirective,
    I18nPipe,
  ],
  template: `
    <div class="page-layout">
      <!-- Header with gradient background -->
      <div class="header">
        <div class="header-left">
          <button mat-icon-button class="back-button" (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h1>{{ 'contacts' | i18n }}</h1>
        </div>
        <div class="header-right">
          <!-- Compact person_add glyph on desktop AND mobile (the old mobile
               page-header affordance) -->
          <button
            mat-icon-button
            class="add-button--icon"
            (click)="showAddForm.set(true)"
            [disabled]="showAddForm()"
            [matTooltip]="'add_contact' | i18n"
          >
            <mat-icon>person_add</mat-icon>
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="content">
        <!-- Add/Edit Contact Form -->
        @if (showAddForm()) {
          <div class="form-card">
            <h3 class="form-title">
              {{ editingContact() ? ('edit_contact' | i18n) : ('add_contact' | i18n) }}
            </h3>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'contact_name' | i18n }}</mat-label>
              <input
                matInput
                [(ngModel)]="formName"
                [placeholder]="'contact_name_placeholder' | i18n"
                maxlength="50"
                autocomplete="off"
              />
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'address' | i18n }}</mat-label>
              <input
                matInput
                [(ngModel)]="formAddress"
                [placeholder]="'address_placeholder' | i18n"
                (ngModelChange)="validateAddress()"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
              />
              @if (addressValid()) {
                <mat-icon
                  matSuffix
                  class="address-badge address-badge-valid"
                  [matTooltip]="'address_valid' | i18n"
                  >check_circle</mat-icon
                >
              } @else if (addressError()) {
                <mat-icon
                  matSuffix
                  class="address-badge address-badge-invalid"
                  [matTooltip]="addressError()!.key | i18n: addressError()!.params"
                  >error</mat-icon
                >
              }
              @let err = addressError();
              @if (err) {
                <mat-error>{{ err.key | i18n: err.params }}</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'notes_optional' | i18n }}</mat-label>
              <textarea
                matInput
                [(ngModel)]="formNotes"
                [placeholder]="'notes_placeholder' | i18n"
                rows="2"
                maxlength="200"
              ></textarea>
            </mat-form-field>

            <div class="form-actions">
              <button mat-stroked-button (click)="cancelForm()">
                {{ 'cancel' | i18n }}
              </button>
              <button
                mat-raised-button
                color="primary"
                [disabled]="!canSaveContact()"
                (click)="saveContact()"
              >
                {{ editingContact() ? ('save' | i18n) : ('add' | i18n) }}
              </button>
            </div>
          </div>
        }

        <!-- Search Bar -->
        <div class="search-bar">
          <mat-form-field appearance="outline" class="search-field">
            <mat-icon matPrefix>search</mat-icon>
            <input
              matInput
              [ngModel]="searchQuery()"
              (ngModelChange)="onSearchChange($event)"
              [placeholder]="'search_contacts' | i18n"
              autocomplete="off"
            />
            @if (searchQuery()) {
              <button mat-icon-button matSuffix (click)="onSearchChange('')">
                <mat-icon>close</mat-icon>
              </button>
            }
          </mat-form-field>
        </div>

        <!-- Contacts List -->
        <div class="contacts-card">
          @if (filteredContacts().length === 0) {
            <div class="empty-state">
              <mat-icon class="empty-icon">contacts</mat-icon>
              <p>{{ searchQuery() ? ('no_matching_contacts' | i18n) : ('no_contacts' | i18n) }}</p>
              @if (!searchQuery()) {
                <button
                  mat-stroked-button
                  color="primary"
                  class="add-button"
                  (click)="showAddForm.set(true)"
                >
                  <mat-icon>person_add</mat-icon>
                  {{ 'add_contact' | i18n }}
                </button>
              }
            </div>
          } @else {
            <!-- Table header (hidden below the 600px card breakpoint) -->
            <div class="table-header">
              <div class="col-name">{{ 'name' | i18n }}</div>
              <div class="col-address">{{ 'address' | i18n }}</div>
            </div>

            <!-- Fit-derived pagination (same idiom as the transactions page):
                 the row viewport flex-fills the card and FitRowsDirective
                 measures how many rows fit the leftover viewport height —
                 that fit IS the page size, so there is no size selector.
                 The measured row height adapts as the table reflows to cards
                 below 600px. -->
            <div
              class="table-body"
              appFitRows
              [fitRowSelector]="'.table-row'"
              [fitMinRows]="3"
              [fitFallbackRowPx]="56"
              (fitRows)="onFitRows($event)"
            >
              @for (contact of visibleContacts(); track contact.id) {
                <div class="table-row">
                  <div class="col-name">
                    <span class="contact-name">{{ contact.name }}</span>
                    @if (contact.notes) {
                      <mat-icon class="notes-glyph" [matTooltip]="contact.notes"
                        >sticky_note_2</mat-icon
                      >
                    }
                  </div>
                  <div class="col-address">
                    <span class="address-text">{{ contact.address }}</span>
                    <button
                      mat-icon-button
                      class="copy-btn"
                      (click)="copyAddress(contact)"
                      [matTooltip]="'copy_address' | i18n"
                    >
                      <mat-icon>content_copy</mat-icon>
                    </button>
                  </div>
                  <div class="col-notes">
                    <span class="notes-text">{{ contact.notes }}</span>
                  </div>
                  <div class="col-actions">
                    <button mat-icon-button [matMenuTriggerFor]="contactMenu">
                      <mat-icon>more_vert</mat-icon>
                    </button>
                    <mat-menu #contactMenu="matMenu">
                      <button mat-menu-item (click)="sendToContact(contact)">
                        <mat-icon>send</mat-icon>
                        <span>{{ 'send_to_contact' | i18n }}</span>
                      </button>
                      <button mat-menu-item (click)="copyAddress(contact)">
                        <mat-icon>content_copy</mat-icon>
                        <span>{{ 'copy_address' | i18n }}</span>
                      </button>
                      <mat-divider></mat-divider>
                      <button mat-menu-item (click)="editContact(contact)">
                        <mat-icon>edit</mat-icon>
                        <span>{{ 'edit' | i18n }}</span>
                      </button>
                      <button mat-menu-item class="delete-item" (click)="deleteContact(contact)">
                        <mat-icon>delete</mat-icon>
                        <span>{{ 'delete' | i18n }}</span>
                      </button>
                    </mat-menu>
                  </div>
                </div>
              }
            </div>

            @if (filteredContacts().length > pageSize()) {
              <mat-paginator
                [length]="filteredContacts().length"
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
    </div>
  `,
  styles: [
    `
      @use 'breakpoints' as bp;

      /* Fill the routed content column (desktop main-layout .page-wrapper /
         mobile-wallet-layout .wallet-content are both flex columns with a
         bounded height) so the list card can flex into the leftover viewport
         height — giving FitRowsDirective a real height to measure under BOTH
         shells. */
      :host {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .page-layout {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      // Header
      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        height: var(--menu-balance-h);
        padding: 0 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 16px;

        h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 300;
        }
      }

      .back-button {
        color: rgba(255, 255, 255, 0.9);
      }

      .add-button {
        mat-icon {
          margin-right: 4px;
        }
      }

      // The header add affordance: a compact person_add glyph on both desktop
      // and mobile (matches the old mobile page-header).
      .add-button--icon {
        color: white;
      }

      // Content
      .content {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        padding: 24px;
        width: 100%;
        max-width: 700px;
        align-self: center;
        box-sizing: border-box;
      }

      // Form Card
      .form-card {
        flex-shrink: 0;
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 16px 20px;
        margin-bottom: 16px;

        .form-title {
          font-size: 14px;
          font-weight: 600;
          color: rgb(0, 35, 65);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin: 0 0 12px 0;
        }

        .full-width {
          width: 100%;
          margin-bottom: 4px;
        }

        .address-badge-valid {
          color: #2e7d32;
        }

        .address-badge-invalid {
          color: #c62828;
        }

        .form-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          margin-top: 12px;
        }

        // Compact form fields
        ::ng-deep {
          .mat-mdc-form-field-subscript-wrapper {
            min-height: 0;
            height: auto;
          }

          .mat-mdc-text-field-wrapper {
            padding: 0 12px;
          }

          .mat-mdc-form-field-infix {
            min-height: 40px;
            padding-top: 8px;
            padding-bottom: 8px;
          }

          .mdc-floating-label {
            top: 50% !important;
            transform: translateY(-50%) !important;
          }

          .mdc-floating-label--float-above {
            top: 0 !important;
            transform: translateY(-34%) scale(0.75) !important;
          }
        }
      }

      // Search Bar
      .search-bar {
        flex-shrink: 0;
        margin-bottom: 16px;

        .search-field {
          width: 100%;

          ::ng-deep {
            .mat-mdc-form-field-subscript-wrapper {
              display: none;
            }

            .mat-mdc-text-field-wrapper {
              padding: 0 12px;
              background: #fff;
              border-radius: 8px;
            }

            .mat-mdc-form-field-flex {
              height: 40px;
              align-items: center;
            }

            .mat-mdc-form-field-infix {
              min-height: 40px;
              padding-top: 8px;
              padding-bottom: 8px;
            }

            .mat-icon {
              color: #888;
            }
          }
        }
      }

      // Contacts Card — flex-fills the content column so the row viewport
      // has a measurable height (fit-based pagination) at all widths.
      .contacts-card {
        flex: 1 1 0;
        min-height: 200px;
        display: flex;
        flex-direction: column;
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        overflow: hidden;
      }

      // Empty State
      .empty-state {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px 24px;
        color: rgba(0, 0, 0, 0.38);

        .empty-icon {
          font-size: 64px;
          width: 64px;
          height: 64px;
          margin-bottom: 16px;
        }

        p {
          margin: 0 0 16px;
          font-size: 14px;
        }
      }

      .table-header {
        flex-shrink: 0;
        display: flex;
        background: #f5f7fa;
        padding: 10px 16px;
        padding-right: 48px;
        font-size: 12px;
        font-weight: 600;
        color: rgba(0, 0, 0, 0.6);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid #e8e8e8;
      }

      // The measured row viewport: basis 0 so its height comes from the
      // leftover card space, never from its own rows. The fit-sized page
      // never needs to scroll.
      .table-body {
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
      }

      .table-row {
        position: relative;
        display: flex;
        flex-wrap: wrap;
        padding: 10px 16px;
        padding-right: 48px;
        align-items: center;
        border-bottom: 1px solid #f0f0f0;
        transition: background 0.15s ease;

        &:last-child {
          border-bottom: none;
        }

        &:hover {
          background: rgba(0, 0, 0, 0.02);
        }
      }

      .col-name {
        flex: 2;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 6px;

        .contact-name {
          min-width: 0;
          font-weight: 500;
          color: rgb(0, 35, 65);
          font-size: 14px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        // Desktop: a small note indicator after the name; hover shows the note
        // (replaces a reserved notes line). Hidden on mobile, which shows the
        // note inline instead.
        .notes-glyph {
          flex-shrink: 0;
          font-size: 16px;
          width: 16px;
          height: 16px;
          line-height: 16px;
          color: rgba(0, 0, 0, 0.32);
          cursor: help;
        }
      }

      .col-address {
        flex: 3;
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        padding-right: 8px;

        .address-text {
          min-width: 0;
          font-family: monospace;
          font-size: 12px;
          color: #1565c0;
          word-break: break-all;
        }

        // Small, subtle copy glyph right after the address.
        .copy-btn {
          flex-shrink: 0;
          width: 22px;
          height: 22px;
          padding: 0;
          opacity: 0.45;
          display: inline-flex;
          align-items: center;
          justify-content: center;

          &:hover {
            opacity: 0.9;
          }

          mat-icon {
            font-size: 15px;
            width: 15px;
            height: 15px;
            line-height: 15px;
          }
        }
      }

      // Notes: its own full-width line (order 4 → wraps below name/address on
      // wide; stacks after the address on narrow). Absent when the contact
      // has no note.
      .col-notes {
        // Desktop shows notes via the name glyph (hover), so the inline notes
        // line is mobile-only — re-shown in the 600px media query.
        display: none;
        order: 4;
        flex: 1 1 100%;
        min-width: 0;
        padding-left: 2px;

        .notes-text {
          display: block;
          font-size: 12px;
          color: rgba(0, 0, 0, 0.54);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }

      // ⋮ menu: absolute + vertically centered so it spans BOTH the
      // name/address line and the reserved notes line (desktop and mobile).
      .col-actions {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;

        button {
          width: 36px;
          height: 36px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;

          mat-icon {
            font-size: 20px;
            width: 20px;
            height: 20px;
            line-height: 20px;
          }
        }
      }

      .delete-item {
        color: #f44336;
      }

      // Compact paginator (the transactions-page pager).
      mat-paginator {
        flex-shrink: 0;
        border-radius: 0 0 8px 8px;

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

      // Dark theme
      :host-context(.dark-theme) {
        .form-card,
        .contacts-card {
          background: #424242;
        }

        .search-bar .search-field ::ng-deep .mat-mdc-text-field-wrapper {
          background: #424242;
        }

        .table-header {
          background: #333;
          border-color: #555;
        }

        .table-row {
          border-color: #444;

          &:hover {
            background: rgba(255, 255, 255, 0.02);
          }
        }

        .col-name .contact-name {
          color: #90caf9;
        }

        .col-notes .notes-text {
          color: rgba(255, 255, 255, 0.54);
        }

        .col-address .address-text {
          color: #64b5f6;
        }

        .empty-state {
          color: rgba(255, 255, 255, 0.38);
        }
      }

      // Responsive — reflow the table to stacked cards below 600px (tablet
      // portrait, phone). The full address wraps (word-break) at full width.
      @include bp.phone {
        /* Band height comes from --menu-balance-h (shrinks to the mobile
           balance-block height here) — in tandem with the menu balance block
           and the coins page. Only edge padding + title change. */
        .header {
          padding: 0 16px;
        }

        .header-left h1 {
          font-size: 20px;
        }

        .content {
          padding: 16px;
        }

        .table-header {
          display: none;
        }

        .table-row {
          position: relative;
          flex-direction: column;
          align-items: flex-start;
          gap: 3px;
          padding: 8px 16px;
          padding-right: 44px;

          .col-name,
          .col-address,
          .col-notes {
            width: 100%;
          }

          .col-address .address-text {
            word-break: break-all;
          }

          // Mobile card matches the old dedicated view: no inline copy icon
          // (copy stays in the ⋮ menu on the right).
          .col-address .copy-btn {
            display: none;
          }

          // Mobile shows the note inline (touch has no hover) and reserves the
          // line even when empty so every card is the SAME height — uniform
          // rows keep the fit-pagination exact (no white gap above the nav).
          .col-notes {
            display: block;
            min-height: 16px;
          }

          // The desktop hover glyph is hidden on mobile.
          .notes-glyph {
            display: none;
          }

          // ⋮ menu vertically centered over the whole card (spans the three
          // stacked rows), with a larger tap target.
          .col-actions {
            position: absolute;
            right: 4px;
            top: 50%;
            transform: translateY(-50%);
            width: auto;

            button {
              width: 40px;
              height: 40px;

              mat-icon {
                font-size: 24px;
                width: 24px;
                height: 24px;
                line-height: 24px;
              }
            }
          }
        }
      }
    `,
  ],
})
export class ContactListComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly clipboard = inject(ClipboardService);
  private readonly notification = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly i18n = inject(I18nService);
  private readonly store = inject(Store);
  private readonly contactsStore = inject(ContactsStoreService);
  private readonly nodeService = inject(NodeService);
  private readonly appMode = inject(AppModeService);
  private readonly btcx = inject(BtcxWalletService);

  /** Core-mode network (NgRx settings). */
  private readonly coreNetwork = toSignal(this.store.select(selectNetwork), {
    initialValue: 'mainnet' as Network,
  });

  /**
   * Active network resolved for the current node mode: remote / nodeless
   * (desktop remote mode AND every mobile/wallet-only launch) reads the
   * nodeless BTCX wallet's network; Core (managed/external) reads the NgRx
   * settings network. Both are the identical 'mainnet' | 'testnet' |
   * 'regtest' string set the stored `Contact.network` and `store.forNetwork`
   * key on, so the list filters correctly under every mode.
   */
  readonly activeNetwork = computed<Network>(() =>
    this.nodeService.isRemote() ? this.btcx.network() : this.coreNetwork()
  );

  searchQuery = signal('');
  showAddForm = signal(false);
  editingContact = signal<Contact | null>(null);
  addressError = signal<{ key: string; params?: Record<string, string> } | null>(null);
  addressValid = signal(false);

  // Fit-derived pagination: the page size is whatever FitRowsDirective
  // measures fits the row viewport (initial value only covers the first
  // paint before the directive's measurement lands).
  readonly pageSize = signal(8);
  readonly pageIndex = signal(0);

  // Form fields
  formName = '';
  formAddress = '';
  formNotes = '';

  /** Contacts of the active network, filtered by the search query. */
  readonly filteredContacts = computed(() => {
    const byNet = this.contactsStore.forNetwork(this.activeNetwork());
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return byNet;

    return byNet.filter(
      c =>
        c.name.toLowerCase().includes(query) ||
        c.address.toLowerCase().includes(query) ||
        c.notes?.toLowerCase().includes(query)
    );
  });

  /** The current page of the filtered list, clamped when the list shrinks. */
  readonly visibleContacts = computed(() => {
    const all = this.filteredContacts();
    const size = this.pageSize();
    const maxPage = Math.max(0, Math.ceil(all.length / size) - 1);
    const page = Math.min(this.pageIndex(), maxPage);
    return all.slice(page * size, page * size + size);
  });

  ngOnInit(): void {
    // The nodeless wallet's network drives the filter in remote/mobile
    // mode — make sure its status is populated (idempotent, no-op in Core).
    if (this.nodeService.isRemote()) {
      void this.btcx.initialize();
    }

    // Pick up edits made on the other shell (the shared wallet_contacts book).
    this.contactsStore.load();

    // Check for prepopulated address from query param (Add to contacts)
    const addAddress = this.route.snapshot.queryParamMap.get('add');
    if (addAddress) {
      this.formAddress = addAddress;
      this.showAddForm.set(true);
      this.validateAddress();
      // Drop the param so back/refresh does not reopen the form.
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
  }

  goBack(): void {
    this.location.back();
  }

  validateAddress(): boolean {
    this.addressValid.set(false);
    const result = validatePocxAddress(this.formAddress);
    switch (result.kind) {
      case 'empty':
        this.addressError.set(null);
        return false;
      case 'invalid_format':
        this.addressError.set({ key: 'address_invalid_format' });
        return false;
      case 'invalid_checksum':
        this.addressError.set({ key: 'address_invalid_checksum' });
        return false;
      case 'valid': {
        const appNet = this.activeNetwork();
        if (result.network !== appNet) {
          this.addressError.set({
            key: 'address_wrong_network',
            params: {
              addressNetwork: this.i18n.get(result.network),
              appNetwork: this.i18n.get(appNet),
            },
          });
          return false;
        }
        this.addressError.set(null);
        this.addressValid.set(true);
        return true;
      }
    }
  }

  canSaveContact(): boolean {
    return !!(this.formName.trim() && this.formAddress.trim() && !this.addressError());
  }

  saveContact(): void {
    // Final validation gate — catches the case where the user never blurred
    // the address field, or pasted + clicked save in the same tick.
    if (!this.validateAddress()) return;
    if (!this.canSaveContact()) return;

    const editing = this.editingContact();
    // Validation already ensured the address matches the active network.
    const network = this.activeNetwork();

    if (this.contactsStore.hasAddress(network, this.formAddress, editing?.id)) {
      this.notification.error(this.i18n.get('contact_address_exists'));
      return;
    }

    if (editing) {
      this.contactsStore.update(editing.id, this.formName, this.formAddress, this.formNotes);
      this.notification.success(this.i18n.get('contact_updated'));
    } else {
      this.contactsStore.add(network, this.formName, this.formAddress, this.formNotes);
      this.notification.success(this.i18n.get('contact_added'));
    }

    this.cancelForm();
  }

  editContact(contact: Contact): void {
    this.editingContact.set(contact);
    this.formName = contact.name;
    this.formAddress = contact.address;
    this.formNotes = contact.notes || '';
    this.showAddForm.set(true);
    this.validateAddress();
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
      .subscribe(confirmed => {
        if (!confirmed) return;
        this.contactsStore.remove(contact.id);
        this.notification.success(this.i18n.get('contact_deleted'));
      });
  }

  cancelForm(): void {
    this.showAddForm.set(false);
    this.editingContact.set(null);
    this.formName = '';
    this.formAddress = '';
    this.formNotes = '';
    this.addressError.set(null);
    this.addressValid.set(false);
  }

  sendToContact(contact: Contact): void {
    // The mobile-wallet shell (nodeless) routes under /wallet; the desktop
    // shell (Core or remote) uses the top-level send route.
    const sendPath = this.appMode.isNodeless() ? '/wallet/send' : '/send';
    void this.router.navigate([sendPath], { queryParams: { address: contact.address } });
  }

  copyAddress(contact: Contact): void {
    void this.clipboard.copyAddress(contact.address);
  }

  /** Search change: filter and reset to the first page. */
  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.pageIndex.set(0);
  }

  /**
   * New measured fit (reflow, resize, first measurement): adopt it as the
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
}
