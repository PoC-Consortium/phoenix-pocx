import { Component, inject, signal, OnInit, computed } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe } from '../../../../core/i18n';
import { ClipboardService, NotificationService } from '../../../../shared/services';
import { BlockchainRpcService } from '../../../../bitcoin/services/rpc/blockchain-rpc.service';

interface Contact {
  id: string;
  name: string;
  address: string;
  notes?: string;
  createdAt: number;
}

/**
 * ContactListComponent displays the address book.
 *
 * Features:
 * - Add/edit/delete contacts
 * - Search contacts
 * - Copy address to clipboard
 * - Send to contact (navigate to send page)
 * - Persist to localStorage
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
    MatTooltipModule,
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
          <button
            mat-raised-button
            color="primary"
            class="add-button"
            (click)="showAddForm.set(true)"
            [disabled]="showAddForm()"
          >
            <mat-icon>person_add</mat-icon>
            {{ 'add_contact' | i18n }}
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
                (blur)="validateAddress()"
                autocomplete="off"
              />
              @if (addressError()) {
                <mat-error>{{ addressError() }}</mat-error>
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
              (ngModelChange)="searchQuery.set($event)"
              [placeholder]="'search_contacts' | i18n"
              autocomplete="off"
            />
            @if (searchQuery()) {
              <button mat-icon-button matSuffix (click)="searchQuery.set('')">
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
            <div class="contacts-table">
              <!-- Table Header -->
              <div class="table-header">
                <div class="col-name">{{ 'name' | i18n }}</div>
                <div class="col-address">{{ 'address' | i18n }}</div>
                <div class="col-actions"></div>
              </div>

              <!-- Table Body -->
              @for (contact of filteredContacts(); track contact.id) {
                <div class="table-row">
                  <div class="col-name">
                    <span class="contact-name">{{ contact.name }}</span>
                    @if (contact.notes) {
                      <span class="contact-notes">{{ contact.notes }}</span>
                    }
                  </div>
                  <div class="col-address">
                    <span class="address-text">{{ contact.address }}</span>
                  </div>
                  <div class="col-actions">
                    <button
                      mat-icon-button
                      class="copy-btn"
                      (click)="copyAddress(contact)"
                      [matTooltip]="'copy_address' | i18n"
                    >
                      <mat-icon>content_copy</mat-icon>
                    </button>
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
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .page-layout {
        min-height: 100%;
      }

      // Header
      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        padding: 16px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
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

      // Content
      .content {
        padding: 24px;
        max-width: 700px;
        margin: 0 auto;
      }

      // Form Card
      .form-card {
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

      // Contacts Card
      .contacts-card {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        overflow: hidden;
      }

      // Empty State
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
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

      // Table
      .contacts-table {
        width: 100%;
      }

      .table-header {
        display: flex;
        background: #f5f7fa;
        padding: 10px 16px;
        font-size: 12px;
        font-weight: 600;
        color: rgba(0, 0, 0, 0.6);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid #e8e8e8;
      }

      .table-row {
        display: flex;
        padding: 12px 16px;
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
        flex-direction: column;
        gap: 2px;

        .contact-name {
          font-weight: 500;
          color: rgb(0, 35, 65);
          font-size: 14px;
        }

        .contact-notes {
          font-size: 12px;
          color: rgba(0, 0, 0, 0.54);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }

      .col-address {
        flex: 3;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding-right: 8px;

        .address-text {
          font-family: monospace;
          font-size: 12px;
          color: #1565c0;
          word-break: break-all;
        }
      }

      .col-actions {
        width: 80px;
        flex-shrink: 0;
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 4px;

        button {
          width: 32px;
          height: 32px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
            line-height: 18px;
          }
        }

        .copy-btn {
          opacity: 0.5;

          &:hover {
            opacity: 1;
          }
        }
      }

      .delete-item {
        color: #f44336;
      }

      // Dark theme
      :host-context(.dark-theme) {
        .page-layout {
          background: #303030;
        }

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

        .col-name .contact-notes {
          color: rgba(255, 255, 255, 0.54);
        }

        .col-address .address-text {
          color: #64b5f6;
        }

        .empty-state {
          color: rgba(255, 255, 255, 0.38);
        }
      }

      // Responsive
      @media (max-width: 599px) {
        .content {
          padding: 16px;
        }

        .header {
          flex-direction: column;
          gap: 12px;
          align-items: flex-start;

          .header-right {
            width: 100%;

            .add-button {
              width: 100%;
            }
          }
        }

        .table-header {
          display: none;
        }

        .table-row {
          flex-direction: column;
          align-items: flex-start;
          gap: 8px;

          .col-name,
          .col-address {
            width: 100%;
          }

          .col-actions {
            position: absolute;
            right: 8px;
            top: 8px;
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
  private readonly blockchainRpc = inject(BlockchainRpcService);

  contacts = signal<Contact[]>([]);
  searchQuery = signal('');
  showAddForm = signal(false);
  editingContact = signal<Contact | null>(null);
  addressError = signal<string | null>(null);

  // Form fields
  formName = '';
  formAddress = '';
  formNotes = '';

  filteredContacts = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return this.contacts();

    return this.contacts().filter(
      c =>
        c.name.toLowerCase().includes(query) ||
        c.address.toLowerCase().includes(query) ||
        c.notes?.toLowerCase().includes(query)
    );
  });

  ngOnInit(): void {
    this.loadContacts();

    // Check for prepopulated address from query param (Add to contacts)
    const addAddress = this.route.snapshot.queryParamMap.get('add');
    if (addAddress) {
      this.formAddress = addAddress;
      this.showAddForm.set(true);
      this.validateAddress();
    }
  }

  goBack(): void {
    this.location.back();
  }

  loadContacts(): void {
    const stored = localStorage.getItem('wallet_contacts');
    if (stored) {
      try {
        const contacts = JSON.parse(stored) as Contact[];
        // Sort by name
        contacts.sort((a, b) => a.name.localeCompare(b.name));
        this.contacts.set(contacts);
      } catch {
        // Invalid data
      }
    }
  }

  saveContacts(): void {
    localStorage.setItem('wallet_contacts', JSON.stringify(this.contacts()));
  }

  async validateAddress(): Promise<void> {
    if (!this.formAddress) {
      this.addressError.set(null);
      return;
    }

    try {
      const result = await this.blockchainRpc.validateAddress(this.formAddress);
      if (!result.isvalid) {
        this.addressError.set('invalid_address');
      } else {
        this.addressError.set(null);
      }
    } catch {
      this.addressError.set('error_validating_address');
    }
  }

  canSaveContact(): boolean {
    return !!(this.formName.trim() && this.formAddress.trim() && !this.addressError());
  }

  saveContact(): void {
    if (!this.canSaveContact()) return;

    const editing = this.editingContact();

    if (editing) {
      // Update existing contact
      const updated = this.contacts().map(c =>
        c.id === editing.id
          ? {
              ...c,
              name: this.formName.trim(),
              address: this.formAddress.trim(),
              notes: this.formNotes.trim() || undefined,
            }
          : c
      );
      this.contacts.set(updated);
      this.notification.success('Contact updated');
    } else {
      // Add new contact
      const newContact: Contact = {
        id: Date.now().toString(),
        name: this.formName.trim(),
        address: this.formAddress.trim(),
        notes: this.formNotes.trim() || undefined,
        createdAt: Date.now(),
      };
      this.contacts.set(
        [...this.contacts(), newContact].sort((a, b) => a.name.localeCompare(b.name))
      );
      this.notification.success('Contact added');
    }

    this.saveContacts();
    this.cancelForm();
  }

  editContact(contact: Contact): void {
    this.editingContact.set(contact);
    this.formName = contact.name;
    this.formAddress = contact.address;
    this.formNotes = contact.notes || '';
    this.showAddForm.set(true);
  }

  deleteContact(contact: Contact): void {
    if (confirm(`Delete contact "${contact.name}"?`)) {
      const updated = this.contacts().filter(c => c.id !== contact.id);
      this.contacts.set(updated);
      this.saveContacts();
      this.notification.success('Contact deleted');
    }
  }

  cancelForm(): void {
    this.showAddForm.set(false);
    this.editingContact.set(null);
    this.formName = '';
    this.formAddress = '';
    this.formNotes = '';
    this.addressError.set(null);
  }

  sendToContact(contact: Contact): void {
    this.router.navigate(['/send'], { queryParams: { address: contact.address } });
  }

  copyAddress(contact: Contact): void {
    this.clipboard.copyAddress(contact.address);
  }
}
