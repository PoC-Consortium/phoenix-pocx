import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { NotificationService } from '../../../../shared/services';
import {
  NameDialogComponent,
  NameDialogData,
  TypedConfirmDialogComponent,
  TypedConfirmDialogData,
} from '../../../../shared/components';
import {
  BtcxWalletService,
  BtcxNetwork,
  BtcxWalletSummary,
} from '../../../../core/services/btcx-wallet.service';
import { ElectrumServersEditorComponent } from '../../../../shared/components/electrum-servers-editor/electrum-servers-editor.component';
import { isInvalidWalletName, isWalletNameTaken } from '../../wallet-name';
import { PageHeaderComponent } from '../../components/page-header/page-header.component';

/** Width of ONE swipe-revealed action button, px. */
const ACTION_PX = 56;
/** Width of the full reveal (pencil + trash), px. */
const REVEAL_PX = 2 * ACTION_PX;
/** Horizontal drag beyond this arms the reveal on release, px. */
const REVEAL_THRESHOLD_PX = 48;
/** Movement below this stays a tap (no drag, no click suppression), px. */
const DRAG_SLOP_PX = 8;

/**
 * WalletSettingsComponent - mobile wallet settings.
 *
 * Wallet management (the switcher's list — active marker, tap to switch,
 * create/restore entries), network selection, Electrum server list editor
 * (per active network), and lock control (passphrase-encrypted seeds only).
 *
 * Wallet row actions: swiping a row to the RIGHT (pointer events — touch
 * and mouse alike) reveals TWO actions — a pencil (rename, backend
 * `btcx_wallet_rename`) and a trash (delete). There is no per-row
 * overflow icon; the non-swipe fallback is a visually-hidden (visible on
 * focus) per-row "actions" button that opens a menu with switch/rename/
 * delete — Tab + Enter reaches everything without a pointer.
 *
 * Rename opens a simple name-input dialog (shared NameDialogComponent)
 * validated with the same client rules as create ([A-Za-z0-9_-]{1,32},
 * case-insensitive uniqueness). Delete opens a type-the-name-back
 * confirmation matching the backend's `btcx_wallet_delete(name,
 * confirm_name)` contract (case-sensitive). Deletes are trash-based: the
 * backend MOVES the wallet's files to `<network>/.trash/` — nothing is
 * destroyed, and the seed always recovers the funds. The ACTIVE wallet can
 * be neither renamed nor deleted (the backend refuses the open wallet);
 * the UI blocks both with a switch-first hint.
 */
@Component({
  selector: 'app-wallet-settings',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    I18nPipe,
    ElectrumServersEditorComponent,
    PageHeaderComponent,
  ],
  template: `
    <app-mwallet-page-header titleKey="mwallet_settings_title" />

    <div class="page">
      <!-- Wallets (the switcher's management surface) -->
      @if (wallet.hasSeed()) {
        <div class="card">
          <h3>{{ 'wallets' | i18n }}</h3>
          <p class="hint-text">{{ 'mwallet_wallets_hint' | i18n }}</p>

          @for (w of wallet.wallets(); track w.name) {
            <!-- Swipe-right reveals the pencil (rename) + trash (delete)
                 actions. No permanent overflow icon: the keyboard/screen-
                 reader path is the visually-hidden (visible on focus)
                 actions button opening the same operations as a menu. -->
            <div class="wallet-row-wrap">
              <button
                type="button"
                class="row-action row-rename"
                [class.visible]="revealed() === w.name"
                [tabindex]="revealed() === w.name ? 0 : -1"
                [attr.aria-hidden]="revealed() !== w.name"
                [attr.aria-label]="'mwallet_rename_wallet' | i18n"
                [disabled]="busy() || switching() !== null || deleting() !== null"
                (click)="confirmRename(w)"
              >
                <mat-icon>edit</mat-icon>
              </button>
              <button
                type="button"
                class="row-action row-delete"
                [class.visible]="revealed() === w.name"
                [tabindex]="revealed() === w.name ? 0 : -1"
                [attr.aria-hidden]="revealed() !== w.name"
                [attr.aria-label]="'mwallet_delete_wallet' | i18n"
                [disabled]="busy() || switching() !== null || deleting() !== null"
                (click)="confirmDelete(w)"
              >
                @if (deleting() === w.name) {
                  <mat-spinner diameter="18"></mat-spinner>
                } @else {
                  <mat-icon>delete</mat-icon>
                }
              </button>

              <div
                class="wallet-row"
                [class.active]="w.isActive"
                [class.disabled]="switching() !== null || deleting() !== null"
                [class.dragging]="isDragging(w.name)"
                [style.transform]="rowTransform(w.name)"
                (pointerdown)="onRowPointerDown($event, w.name)"
                (pointermove)="onRowPointerMove($event)"
                (pointerup)="onRowPointerUp($event)"
                (pointercancel)="onRowPointerCancel($event)"
                (click)="onRowClick(w)"
              >
                <mat-icon class="row-icon" [class.active]="w.isActive"
                  >account_balance_wallet</mat-icon
                >
                <div class="row-main">
                  <span class="row-name">{{ w.name }}</span>
                  <!-- Same badge family as the switcher menu: taproot
                       purple, segwit neutral, legacy amber; imported
                       (descriptor-source) wallets carry a subtle second
                       marker. -->
                  <div class="row-badges">
                    <span
                      class="row-badge"
                      [class.segwit]="w.policy.kind === 'bip84'"
                      [class.legacy]="w.policy.kind === 'legacy'"
                    >
                      {{
                        (w.policy.kind === 'bip86'
                          ? 'mwallet_kind_taproot'
                          : w.policy.kind === 'legacy'
                            ? 'mwallet_kind_legacy'
                            : 'mwallet_kind_segwit'
                        ) | i18n
                      }}
                    </span>
                    @if (w.source === 'descriptor') {
                      <span class="row-badge imported">
                        {{ 'mwallet_imported_badge' | i18n }}
                      </span>
                    }
                  </div>
                </div>
                @if (w.seedEncrypted && w.seedLocked) {
                  <mat-icon class="row-lock">lock</mat-icon>
                }
                @if (switching() === w.name) {
                  <mat-spinner diameter="18"></mat-spinner>
                } @else if (w.isActive) {
                  <mat-icon class="row-check">check</mat-icon>
                }

                <!-- Keyboard/screen-reader fallback (no visible per-row
                     icon): hidden until focused, opens the action menu. -->
                <button
                  type="button"
                  class="row-actions-a11y"
                  [attr.aria-label]="w.name + ' — ' + ('mwallet_wallet_actions' | i18n)"
                  [matMenuTriggerFor]="rowMenu"
                  (click)="$event.stopPropagation()"
                >
                  <mat-icon>more_horiz</mat-icon>
                </button>
                <mat-menu #rowMenu="matMenu">
                  @if (!w.isActive) {
                    <button mat-menu-item (click)="switchTo(w)">
                      <mat-icon>swap_horiz</mat-icon>
                      <span>{{ 'mwallet_switch_wallet' | i18n }}</span>
                    </button>
                  }
                  <button mat-menu-item (click)="confirmRename(w)">
                    <mat-icon>edit</mat-icon>
                    <span>{{ 'mwallet_rename_wallet' | i18n }}</span>
                  </button>
                  <button mat-menu-item (click)="confirmDelete(w)">
                    <mat-icon>delete</mat-icon>
                    <span>{{ 'mwallet_delete_wallet' | i18n }}</span>
                  </button>
                </mat-menu>
              </div>
            </div>
          }

          <div class="add-wallet-row">
            <button mat-stroked-button routerLink="/wallet/create">
              <mat-icon>add</mat-icon>
              {{ 'mwallet_create_wallet' | i18n }}
            </button>
            <button mat-stroked-button routerLink="/wallet/restore">
              <mat-icon>restore</mat-icon>
              {{ 'mwallet_restore_wallet' | i18n }}
            </button>
            <!-- Third path in, full width below Create/Restore: import an
                 existing wallet from its descriptor strings. -->
            <button mat-stroked-button class="import-descriptor" routerLink="/wallet/import">
              <mat-icon>input</mat-icon>
              {{ 'mwallet_import_wallet' | i18n }}
            </button>
          </div>
        </div>
      }

      <!-- Network -->
      <div class="card">
        <h3>{{ 'network' | i18n }}</h3>
        <p class="hint-text">{{ 'mwallet_network_hint' | i18n }}</p>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>{{ 'network' | i18n }}</mat-label>
          <mat-select
            [ngModel]="wallet.network()"
            (ngModelChange)="setNetwork($event)"
            [disabled]="busy()"
          >
            @for (net of networks; track net) {
              <mat-option [value]="net">{{ net | i18n }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      <!-- Electrum servers -->
      <div class="card">
        <h3>{{ 'mwallet_electrum_servers' | i18n }}</h3>
        <p class="hint-text">{{ 'mwallet_electrum_hint' | i18n }}</p>

        <app-electrum-servers-editor
          [servers]="wallet.electrumServers()"
          [network]="wallet.network()"
          [disabled]="busy()"
          [showTest]="true"
          (serversChange)="saveServers($event)"
        />
      </div>

      <!-- Lock (passphrase-encrypted seeds only) -->
      @if (wallet.seedEncrypted() && wallet.seedState() === 'unlocked') {
        <div class="card">
          <h3>{{ 'mwallet_lock_wallet' | i18n }}</h3>
          <button mat-stroked-button class="full-width" [disabled]="busy()" (click)="lock()">
            <mat-icon>lock</mat-icon>
            {{ 'mwallet_lock_wallet' | i18n }}
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .page {
        padding: 16px;
        display: flex;
        flex-direction: column;
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
          margin: 0 0 8px;
          font-size: 15px;
          font-weight: 500;
        }
      }

      .hint-text {
        color: rgba(0, 0, 0, 0.6);
        font-size: 13px;
        margin: 0 0 16px;
      }

      .full-width {
        width: 100%;
      }

      /* Wallet management rows (the switcher's list, settings-card form).
         Each row slides over TWO actions (pencil + trash) revealed by a
         right swipe. */
      .wallet-row-wrap {
        position: relative;
        overflow: hidden;
        border-radius: 6px;
      }

      .row-action {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 56px; /* ACTION_PX */
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        color: white;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s ease;

        &.visible {
          opacity: 1;
        }

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }

        mat-spinner {
          --mdc-circular-progress-active-indicator-color: white;
        }
      }

      .row-rename {
        left: 0;
        border-radius: 6px 0 0 6px;
        background: #1976d2;
      }

      .row-delete {
        left: 56px; /* ACTION_PX */
        background: #c62828;
      }

      .wallet-row {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 8px;
        border-radius: 6px;
        cursor: pointer;
        /* Solid background — the row must cover the trash action while
           closed and while sliding. */
        background: white;
        /* Horizontal drags belong to the swipe; vertical stays scrolling. */
        touch-action: pan-y;
        user-select: none;
        -webkit-user-select: none;
        transition: transform 0.15s ease;

        &.dragging {
          transition: none;
        }

        &.active {
          background: #ecf4fb; /* white + rgba(25,118,210,.08), solid */
        }

        &.disabled {
          pointer-events: none;
          opacity: 0.6;
        }

        /* A11y fallback: invisible (and click-transparent) until it takes
           keyboard focus — no permanent per-row overflow icon. */
        .row-actions-a11y {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          padding: 0;
          border: none;
          border-radius: 50%;
          background: transparent;
          cursor: pointer;
          color: rgba(0, 0, 0, 0.5);
          flex-shrink: 0;
          opacity: 0;
          pointer-events: none;

          &:focus {
            opacity: 1;
            pointer-events: auto;
          }

          &:focus-visible {
            outline: 2px solid #1976d2;
            outline-offset: 1px;
          }

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
          }
        }

        .row-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          color: rgba(0, 0, 0, 0.4);

          &.active {
            color: #1976d2;
          }
        }

        .row-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;

          .row-name {
            font-size: 14px;
            font-weight: 500;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .row-badges {
            display: flex;
            gap: 4px;
            align-items: center;
          }

          .row-badge {
            align-self: flex-start;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            color: #7b1fa2;
            border: 1px solid currentColor;
            border-radius: 8px;
            padding: 0 6px;
            margin-top: 2px;

            &.segwit {
              color: #546e7a;
            }

            /* Pre-segwit imports: same family, amber hue. */
            &.legacy {
              color: #b26a00;
            }

            /* Descriptor-source marker: quieter than the kind badge. */
            &.imported {
              color: #78909c;
              border-style: dashed;
              font-weight: 500;
            }
          }
        }

        .row-lock {
          font-size: 16px;
          width: 16px;
          height: 16px;
          color: #4caf50;
        }

        .row-check {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: #1976d2;
        }
      }

      .add-wallet-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;

        button {
          flex: 1 1 calc(50% - 4px);
        }

        /* Third path in, spanning both columns (owner's spec). */
        .import-descriptor {
          flex-basis: 100%;
        }
      }

      .server-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 4px 0 4px 12px;
        background: #f5f7fa;
        border-radius: 6px;
        margin-bottom: 8px;

        .server-url {
          font-family: monospace;
          font-size: 12px;
          word-break: break-all;
          flex: 1;
        }
      }

      .add-row {
        display: flex;
        align-items: center;
        gap: 8px;

        .server-field {
          flex: 1;
        }

        .add-button {
          height: 40px;
          flex-shrink: 0;
        }
      }

      :host-context(.dark-theme) {
        .card {
          background: #424242;
        }

        .hint-text {
          color: rgba(255, 255, 255, 0.6);
        }

        .server-row {
          background: #333;
        }

        .wallet-row {
          background: #424242;

          &.active {
            background: #465058; /* #424242 + rgba(100,181,246,.12), solid */
          }

          .row-icon {
            color: rgba(255, 255, 255, 0.4);

            &.active {
              color: #64b5f6;
            }
          }

          .row-main .row-badge {
            color: #ce93d8;

            &.segwit {
              color: #90a4ae;
            }
          }

          .row-check {
            color: #64b5f6;
          }

          .row-actions-a11y {
            color: rgba(255, 255, 255, 0.55);
          }
        }
      }
    `,
  ],
})
export class WalletSettingsComponent implements OnInit {
  readonly wallet = inject(BtcxWalletService);
  private readonly notification = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly dialog = inject(MatDialog);

  readonly networks: BtcxNetwork[] = ['mainnet', 'testnet', 'regtest'];
  readonly busy = signal(false);

  /** Name of the wallet a switch is in flight for, or null. */
  readonly switching = signal<string | null>(null);

  /** Name of the wallet a delete is in flight for, or null. */
  readonly deleting = signal<string | null>(null);

  /** Name of the row whose trash action is revealed, or null. */
  readonly revealed = signal<string | null>(null);

  // --- Swipe-reveal state (pointer events: touch AND mouse drags) ---
  /** Row a pointer went down on, while the pointer is held. */
  private dragName: string | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  /** True once movement exceeded the slop — the gesture is a drag. */
  private dragActive = false;
  /** Live translateX of the dragged row, px (signal: drives the style). */
  private readonly dragX = signal(0);
  /** Swallow the click that follows a drag release. */
  private suppressClick = false;

  ngOnInit(): void {
    void this.wallet.initialize().then(() => this.wallet.refreshWallets());
  }

  /** Switch the active wallet (same flow as the header switcher). */
  async switchTo(w: BtcxWalletSummary): Promise<void> {
    if (w.isActive || this.switching() !== null) return;
    this.switching.set(w.name);
    try {
      await this.wallet.select(w.name);
    } catch (err) {
      console.error('Failed to switch wallet:', err);
      this.notification.error(`${err}`);
    } finally {
      this.switching.set(null);
    }
  }

  // ==========================================================================
  // Swipe-to-reveal (delete) — pointerdown/move/up with a translateX
  // threshold; works with mouse drags too. The row's overflow button
  // toggles the same reveal so the action is never swipe-only.
  // ==========================================================================

  isDragging(name: string): boolean {
    return this.dragActive && this.dragName === name;
  }

  /** translateX of a row: live drag position, the parked reveal, or none. */
  rowTransform(name: string): string | null {
    if (this.isDragging(name)) return `translateX(${this.dragX()}px)`;
    if (this.revealed() === name) return `translateX(${REVEAL_PX}px)`;
    return null;
  }

  onRowPointerDown(event: PointerEvent, name: string): void {
    if (this.switching() !== null || this.deleting() !== null) return;
    this.dragName = name;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragActive = false;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // A pointer gone by capture time (e.g. an interrupted touch) is fine —
      // the gesture simply proceeds uncaptured.
    }
  }

  onRowPointerMove(event: PointerEvent): void {
    if (this.dragName === null) return;
    const dx = event.clientX - this.dragStartX;
    const dy = event.clientY - this.dragStartY;
    if (!this.dragActive) {
      // Below the slop it is still a tap; a mostly-vertical move is a scroll.
      if (Math.abs(dx) < DRAG_SLOP_PX) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        this.dragName = null;
        return;
      }
      this.dragActive = true;
    }
    const base = this.revealed() === this.dragName ? REVEAL_PX : 0;
    this.dragX.set(Math.min(Math.max(base + dx, 0), REVEAL_PX));
  }

  onRowPointerUp(event: PointerEvent): void {
    if (this.dragName === null) return;
    if (this.dragActive) {
      this.revealed.set(this.dragX() > REVEAL_THRESHOLD_PX ? this.dragName : null);
      // The browser still fires a click after the pointer sequence.
      this.suppressClick = true;
    }
    this.endDrag(event);
  }

  onRowPointerCancel(event: PointerEvent): void {
    if (this.dragName === null) return;
    this.endDrag(event);
  }

  private endDrag(event: PointerEvent): void {
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // Already released (or never captured) — nothing to undo.
    }
    this.dragName = null;
    this.dragActive = false;
  }

  /** Row tap: close an open reveal first, otherwise switch to the wallet. */
  onRowClick(w: BtcxWalletSummary): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (this.revealed() !== null) {
      this.revealed.set(null);
      return;
    }
    void this.switchTo(w);
  }

  // ==========================================================================
  // Delete (trash-based: files move to <network>/.trash/, never destroyed)
  // ==========================================================================

  /**
   * Trash tap: the ACTIVE wallet is blocked with a switch-first hint (the
   * backend refuses the open wallet); any other wallet gets the
   * type-the-name-back confirmation, case-SENSITIVE like the backend's
   * `confirm_name` check.
   */
  confirmDelete(w: BtcxWalletSummary): void {
    if (this.deleting() !== null) return;
    if (w.isActive) {
      this.notification.info(this.i18n.get('mwallet_delete_active_hint'));
      return;
    }
    const data: TypedConfirmDialogData = {
      title: this.i18n.get('mwallet_delete_wallet'),
      message: this.i18n.get('mwallet_delete_message', { name: w.name }),
      requiredText: w.name,
      inputLabel: this.i18n.get('mwallet_delete_type_name'),
      confirmText: this.i18n.get('delete'),
      cancelText: this.i18n.get('cancel'),
    };
    this.dialog
      .open(TypedConfirmDialogComponent, { data, width: '360px' })
      .afterClosed()
      .subscribe((typed: string | undefined) => {
        if (typed === undefined) return;
        void this.doDelete(w.name, typed);
      });
  }

  private async doDelete(name: string, confirmName: string): Promise<void> {
    this.deleting.set(name);
    try {
      // The service refreshes config + status; refreshConfig also refreshes
      // the registry list this page renders.
      await this.wallet.delete(name, confirmName);
      this.notification.success(this.i18n.get('mwallet_deleted', { name }));
    } catch (err) {
      console.error('Failed to delete wallet:', err);
      this.notification.error(`${err}`);
    } finally {
      this.revealed.set(null);
      this.deleting.set(null);
    }
  }

  // ==========================================================================
  // Rename (registry + data-dir move; `btcx_wallet_rename`)
  // ==========================================================================

  /**
   * Pencil tap: the ACTIVE wallet is blocked with a switch-first hint (the
   * backend refuses the open wallet, same as delete); any other wallet gets
   * a name-input dialog validated with the create flow's client rules.
   */
  confirmRename(w: BtcxWalletSummary): void {
    if (this.deleting() !== null || this.switching() !== null) return;
    if (w.isActive) {
      this.notification.info(this.i18n.get('mwallet_rename_active_hint'));
      return;
    }
    const others = this.wallet
      .wallets()
      .map(x => x.name)
      .filter(n => n !== w.name);
    const data: NameDialogData = {
      title: this.i18n.get('mwallet_rename_wallet'),
      inputLabel: this.i18n.get('wallet_name'),
      initialValue: w.name,
      hint: this.i18n.get('wallet_name_hint_local'),
      confirmText: this.i18n.get('mwallet_rename_wallet'),
      cancelText: this.i18n.get('cancel'),
      validate: (value: string) => {
        if (isInvalidWalletName(value)) return this.i18n.get('wallet_name_invalid_local');
        // Case-insensitive uniqueness against the OTHER wallets — a
        // case-only rename of this same wallet stays allowed (the backend
        // treats it as the same directory).
        if (isWalletNameTaken(value, others)) return this.i18n.get('wallet_name_conflict');
        return null;
      },
    };
    this.dialog
      .open(NameDialogComponent, { data, width: '360px' })
      .afterClosed()
      .subscribe((newName: string | undefined) => {
        if (newName === undefined || newName === w.name) return;
        void this.doRename(w.name, newName);
      });
  }

  private async doRename(name: string, newName: string): Promise<void> {
    try {
      await this.wallet.rename(name, newName);
      this.notification.success(this.i18n.get('mwallet_renamed', { name: newName }));
    } catch (err) {
      console.error('Failed to rename wallet:', err);
      this.notification.error(`${err}`);
    } finally {
      this.revealed.set(null);
    }
  }

  async setNetwork(network: BtcxNetwork): Promise<void> {
    if (network === this.wallet.network() || this.busy()) return;
    this.busy.set(true);
    try {
      await this.wallet.setConfig({ network });
    } catch (err) {
      console.error('Failed to set network:', err);
      this.notification.error(`${err}`);
    } finally {
      this.busy.set(false);
    }
  }

  async saveServers(electrumServers: string[]): Promise<void> {
    this.busy.set(true);
    try {
      await this.wallet.setConfig({ electrumServers });
    } catch (err) {
      console.error('Failed to update Electrum servers:', err);
      this.notification.error(`${err}`);
    } finally {
      this.busy.set(false);
    }
  }

  async lock(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.wallet.lock();
      this.notification.success(this.i18n.get('mwallet_locked_title'));
    } finally {
      this.busy.set(false);
    }
  }
}
