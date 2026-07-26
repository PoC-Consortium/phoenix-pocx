import { Component, inject, input, output, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nPipe, I18nService } from '../../../core/i18n';
import {
  BtcxWalletService,
  BtcxWalletGroup,
  BtcxCompartment,
} from '../../../core/services/btcx-wallet.service';
import { NotificationService } from '../../services';
import { NameDialogComponent, NameDialogData } from '../name-dialog/name-dialog.component';
import {
  TypedConfirmDialogComponent,
  TypedConfirmDialogData,
} from '../typed-confirm-dialog/typed-confirm-dialog.component';
import {
  isInvalidWalletName,
  isWalletNameTaken,
} from '../../../features/mobile-wallet/wallet-name';

/** Width of ONE swipe-revealed action button, px. */
const ACTION_PX = 56;
/** Width of the full reveal (pencil + trash), px. */
const REVEAL_PX = 2 * ACTION_PX;
/** Past this drag distance the reveal parks open. */
const REVEAL_THRESHOLD_PX = 48;
/** Movement below this is a tap, not a drag. */
const DRAG_SLOP_PX = 8;

/**
 * WalletGroupMenuComponent — THE btcx wallet switcher menu content: one
 * swipe-able row per wallet GROUP (right-swipe reveals tandem rename +
 * delete, the trash-based registry operations), plus the create / restore /
 * import entries and an optional "manage wallets" link. Shared by the
 * mobile shell's toolbar chip and the desktop toolbar in remote mode —
 * mount it INSIDE a `mat-menu` and wire:
 *
 *   (selectGroup)  — host switches to the group (semantics differ: mobile
 *                    lands on the home unlock form when locked, desktop
 *                    prompts the passphrase dialog)
 *   (requestClose) — host closes its MatMenuTrigger (rows are custom
 *                    elements, not mat-menu-items, so the menu does not
 *                    auto-close)
 *   [switching]    — group name a switch is in flight for (row spinner)
 *
 * Call `resetReveal()` from the trigger's `(menuOpened)` so a parked
 * swipe-reveal never survives a re-open.
 */
@Component({
  selector: 'app-wallet-group-menu',
  standalone: true,
  imports: [
    RouterModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    I18nPipe,
  ],
  template: `
    @if (showManage()) {
      <!-- Not a plain routerLink: /auth is noAuthGuard-ed, the host must
           clear/close the active wallet first (its manageWallets()). -->
      <button mat-menu-item (click)="requestClose.emit(); manage.emit()">
        <mat-icon>settings</mat-icon>
        <span>{{ 'manage_wallets' | i18n }}</span>
      </button>
      <mat-divider></mat-divider>
    }

    @for (g of wallet.groups(); track g.group) {
      <div class="wallet-row-wrap">
        <button
          type="button"
          class="row-action row-rename"
          [class.visible]="revealed() === g.group"
          [tabindex]="revealed() === g.group ? 0 : -1"
          [attr.aria-hidden]="revealed() !== g.group"
          [attr.aria-label]="'mwallet_rename_wallet' | i18n"
          [disabled]="switching() !== null || deleting() !== null"
          (click)="confirmRenameGroup(g)"
        >
          <mat-icon>edit</mat-icon>
        </button>
        <button
          type="button"
          class="row-action row-delete"
          [class.visible]="revealed() === g.group"
          [tabindex]="revealed() === g.group ? 0 : -1"
          [attr.aria-hidden]="revealed() !== g.group"
          [attr.aria-label]="'mwallet_delete_wallet' | i18n"
          [disabled]="switching() !== null || deleting() !== null"
          (click)="confirmDeleteGroup(g)"
        >
          @if (deleting() === g.group) {
            <mat-spinner diameter="18"></mat-spinner>
          } @else {
            <mat-icon>delete</mat-icon>
          }
        </button>

        <div
          class="wallet-row swipe-row"
          [class.active]="g.isActive"
          [class.disabled]="switching() !== null || deleting() !== null"
          [class.dragging]="isDragging(g.group)"
          [style.transform]="rowTransform(g.group)"
          (pointerdown)="onRowPointerDown($event, g.group)"
          (pointermove)="onRowPointerMove($event)"
          (pointerup)="onRowPointerUp($event)"
          (pointercancel)="onRowPointerCancel($event)"
          (click)="onGroupRowClick(g)"
        >
          <div class="wallet-row-content">
            <mat-icon class="wallet-row-icon" [class.active]="g.isActive"
              >account_balance_wallet</mat-icon
            >
            <span class="wallet-row-name">{{ g.group }}</span>
            @if (singletonOf(g)?.policy?.kind === 'legacy') {
              <span class="wallet-row-badge legacy">{{ 'mwallet_legacy_badge' | i18n }}</span>
            }
            @if (singletonOf(g)?.singleAddress) {
              <span class="wallet-row-badge single">{{ 'mwallet_single_badge' | i18n }}</span>
            }
            @if (groupLocked(g)) {
              <mat-icon class="wallet-row-lock">lock</mat-icon>
            }
            @if (switching() === g.group) {
              <mat-spinner diameter="16" class="wallet-row-spinner"></mat-spinner>
            } @else if (g.isActive) {
              <mat-icon class="wallet-row-check">check</mat-icon>
            }
          </div>
        </div>
      </div>
    }
    <mat-divider></mat-divider>
    <button mat-menu-item [routerLink]="createLink()" (click)="requestClose.emit()">
      <mat-icon>add</mat-icon>
      <span>{{ 'mwallet_create_wallet' | i18n }}</span>
    </button>
    <button mat-menu-item [routerLink]="restoreLink()" (click)="requestClose.emit()">
      <mat-icon>restore</mat-icon>
      <span>{{ 'mwallet_restore_wallet' | i18n }}</span>
    </button>
    @if (importLink()) {
      <button mat-menu-item [routerLink]="importLink()" (click)="requestClose.emit()">
        <mat-icon>input</mat-icon>
        <span>{{ 'mwallet_import_wallet' | i18n }}</span>
      </button>
    }
  `,
  styles: [
    `
      /* Swipe rows: each group row slides over the pencil (tandem rename)
         + trash (tandem delete) actions. */
      .wallet-row-wrap {
        position: relative;
        overflow: hidden;
        min-width: 220px;
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
        background: #1976d2;
      }

      .row-delete {
        left: 56px; /* ACTION_PX */
        background: #c62828;
      }

      .swipe-row {
        position: relative;
        padding: 10px 16px;
        background: white;
        cursor: pointer;
        touch-action: pan-y;
        user-select: none;
        -webkit-user-select: none;
        transition: transform 0.15s ease;

        &.dragging {
          transition: none;
        }

        &.active {
          background: #ecf4fb;
        }

        &.disabled {
          pointer-events: none;
          opacity: 0.6;
        }
      }

      .wallet-row-content {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 180px;

        .wallet-row-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          color: rgba(0, 0, 0, 0.4);
          margin: 0;

          &.active {
            color: #1976d2;
          }
        }

        .wallet-row-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .wallet-row-badge {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: #7b1fa2;
          border: 1px solid currentColor;
          border-radius: 8px;
          padding: 0 6px;
          flex-shrink: 0;

          &.legacy {
            color: #b26a00;
          }

          &.single {
            color: #00796b;
          }
        }

        .wallet-row-lock {
          font-size: 16px;
          width: 16px;
          height: 16px;
          color: #4caf50;
          margin: 0;
          flex-shrink: 0;
        }

        .wallet-row-check {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: #1976d2;
          margin: 0;
          flex-shrink: 0;
        }

        .wallet-row-spinner {
          flex-shrink: 0;
        }
      }

      :host-context(.dark-theme) .swipe-row {
        background: #424242;

        &.active {
          background: #465058;
        }

        .wallet-row-icon {
          color: rgba(255, 255, 255, 0.5);

          &.active {
            color: #90caf9;
          }
        }
      }
    `,
  ],
})
export class WalletGroupMenuComponent {
  protected readonly wallet = inject(BtcxWalletService);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly i18n = inject(I18nService);

  /** Group name a switch is in flight for (host-driven), or null. */
  readonly switching = input<string | null>(null);
  /** Show the "manage wallets" top entry (desktop); host handles `manage`. */
  readonly showManage = input(false);
  readonly manage = output<void>();
  readonly createLink = input.required<string>();
  readonly restoreLink = input.required<string>();
  /** Optional descriptor-import entry (mobile shell only today). */
  readonly importLink = input<string | null>(null);

  readonly selectGroup = output<BtcxWalletGroup>();
  readonly requestClose = output<void>();

  /** Name of the group a delete is in flight for, or null. */
  readonly deleting = signal<string | null>(null);

  /** Name of the row whose actions are revealed, or null. */
  readonly revealed = signal<string | null>(null);

  private dragName: string | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragActive = false;
  private readonly dragX = signal(0);
  private suppressClick = false;

  /** Host hook for (menuOpened): a parked reveal never survives a re-open. */
  resetReveal(): void {
    this.revealed.set(null);
  }

  /**
   * Group padlock: shown only while the group is CLOSED and a member
   * reports its encrypted seed locked. An open pocket means the seed is
   * unlocked — sibling compartments report seedLocked merely because
   * their stores aren't the open one.
   */
  groupLocked(g: BtcxWalletGroup): boolean {
    if (g.compartments.some(c => c.isOpen)) return false;
    return g.compartments.some(c => c.seedEncrypted && c.seedLocked);
  }

  /** The lone compartment of a singleton group, else null. */
  singletonOf(g: BtcxWalletGroup): BtcxCompartment | null {
    return g.compartments.length === 1 ? g.compartments[0] : null;
  }

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
      // A pointer gone by capture time is fine — the gesture proceeds
      // uncaptured.
    }
  }

  onRowPointerMove(event: PointerEvent): void {
    if (this.dragName === null) return;
    const dx = event.clientX - this.dragStartX;
    const dy = event.clientY - this.dragStartY;
    if (!this.dragActive) {
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
      // Already released (or never captured).
    }
    this.dragName = null;
    this.dragActive = false;
  }

  /** Row tap: close an open reveal first, otherwise switch + close menu. */
  onGroupRowClick(g: BtcxWalletGroup): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (this.revealed() !== null) {
      this.revealed.set(null);
      return;
    }
    this.requestClose.emit();
    this.selectGroup.emit(g);
  }

  /**
   * Pencil tap: the ACTIVE group is blocked with a switch-first hint (the
   * backend refuses while a member is open); any other group gets a
   * name-input dialog. Tandem: the group id and every member's name move
   * together.
   */
  confirmRenameGroup(g: BtcxWalletGroup): void {
    if (this.deleting() !== null || this.switching() !== null) return;
    this.requestClose.emit();
    if (g.isActive) {
      this.notification.info(this.i18n.get('mwallet_rename_active_hint'));
      return;
    }
    const members = new Set(g.compartments.map(c => c.name));
    const others = this.wallet
      .wallets()
      .map(x => x.name)
      .filter(n => !members.has(n));
    const data: NameDialogData = {
      title: this.i18n.get('mwallet_rename_wallet'),
      inputLabel: this.i18n.get('wallet_name'),
      initialValue: g.group,
      hint: this.i18n.get('wallet_name_hint_local'),
      confirmText: this.i18n.get('mwallet_rename_wallet'),
      cancelText: this.i18n.get('cancel'),
      validate: (value: string) => {
        if (isInvalidWalletName(value)) return this.i18n.get('wallet_name_invalid_local');
        if (isWalletNameTaken(value, others)) return this.i18n.get('wallet_name_conflict');
        return null;
      },
    };
    this.dialog
      .open(NameDialogComponent, { data, width: '360px' })
      .afterClosed()
      .subscribe((newName: string | undefined) => {
        if (newName === undefined || newName === g.group) return;
        void this.doRenameGroup(g.group, newName);
      });
  }

  private async doRenameGroup(group: string, newGroup: string): Promise<void> {
    try {
      await this.wallet.renameGroup(group, newGroup);
      this.notification.success(this.i18n.get('mwallet_renamed', { name: newGroup }));
    } catch (err) {
      console.error('Failed to rename wallet group:', err);
      this.notification.error(`${err}`);
    } finally {
      this.revealed.set(null);
    }
  }

  /**
   * Trash tap: the ACTIVE group is blocked with a switch-first hint; any
   * other group gets the type-the-name-back confirmation. Tandem +
   * trash-based: every member moves to the network's trash directory.
   */
  confirmDeleteGroup(g: BtcxWalletGroup): void {
    if (this.deleting() !== null) return;
    this.requestClose.emit();
    if (g.isActive) {
      this.notification.info(this.i18n.get('mwallet_delete_active_hint'));
      return;
    }
    const data: TypedConfirmDialogData = {
      title: this.i18n.get('mwallet_delete_wallet'),
      message: this.i18n.get(
        g.compartments.length > 1 ? 'mwallet_delete_group_message' : 'mwallet_delete_message',
        { name: g.group }
      ),
      requiredText: g.group,
      inputLabel: this.i18n.get('mwallet_delete_type_name'),
      confirmText: this.i18n.get('delete'),
      cancelText: this.i18n.get('cancel'),
    };
    this.dialog
      .open(TypedConfirmDialogComponent, { data, width: '360px' })
      .afterClosed()
      .subscribe((typed: string | undefined) => {
        if (typed === undefined) return;
        void this.doDeleteGroup(g.group, typed);
      });
  }

  private async doDeleteGroup(group: string, confirmName: string): Promise<void> {
    this.deleting.set(group);
    try {
      await this.wallet.deleteGroup(group, confirmName);
      this.notification.success(this.i18n.get('mwallet_deleted', { name: group }));
    } catch (err) {
      console.error('Failed to delete wallet group:', err);
      this.notification.error(`${err}`);
    } finally {
      this.revealed.set(null);
      this.deleting.set(null);
    }
  }
}
