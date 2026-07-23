import { Component, computed, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { QRCodeComponent } from 'angularx-qrcode';
import { Subject } from 'rxjs';
import { takeUntil, skip } from 'rxjs/operators';
import { I18nPipe } from '../../../../core/i18n';
import { ClipboardService, NotificationService } from '../../../../shared/services';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { buildPaymentUri } from '../../../../bitcoin/utils/payment-uri';
import { NodeService } from '../../../../node/services/node.service';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';
import { BackendRouterService } from '../../../../core/backend/backend-router.service';
import { WalletRpcService } from '../../../../bitcoin/services/rpc/wallet-rpc.service';

interface AddressInfo {
  address: string;
  purpose: string;
  isUsed: boolean;
  txCount: number;
  label: string;
  /** Address of a retired legacy (v30 / coin-0) chain. */
  isLegacy?: boolean;
}

/**
 * ReceiveComponent - Compact, mobile-style receive page (same design at
 * desktop, just slightly wider). Shows the latest VIRGIN (first-unused)
 * address with its QR by default plus a single "Generate new address"
 * button — no past-address selector.
 */
@Component({
  selector: 'app-receive',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSelectModule,
    QRCodeComponent,
    I18nPipe,
  ],
  template: `
    <div class="page-layout">
      <!-- Header -->
      <div class="header">
        <div class="header-left">
          <button mat-icon-button class="back-button" (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h1>{{ 'receive' | i18n }}</h1>
        </div>
      </div>

      <!-- Content -->
      <div class="content">
        <div class="receive-card">
          @if (spendOnly()) {
            <!-- Remote mode, legacy (v30) pocket: spend-only. No receive
                 address is derived — receiving into the retired coin-0'
                 branch is what the compartment redesign exists to stop. -->
            <div class="spend-only">
              <mat-icon class="spend-only-icon">block</mat-icon>
              <span>{{ 'mwallet_receive_v30_blocked' | i18n }}</span>
            </div>
          } @else if (selectedAddress()) {
            <!-- 1. Address selector: latest virgin preselected; Core mode
                 lists the full revealed history, remote lists what the seam
                 knows (current + freshly generated). Copy via the suffix. -->
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'select_address' | i18n }}</mat-label>
              <mat-select
                [ngModel]="selectedAddress()"
                (ngModelChange)="selectedAddress.set($event)"
              >
                <!-- Closed trigger shows ONLY the address — the (label /
                     never used) suffix belongs to the open panel rows. -->
                <mat-select-trigger>
                  <span class="address-option">{{ selectedAddress() }}</span>
                </mat-select-trigger>
                @for (addr of existingAddresses(); track addr.address) {
                  <mat-option [value]="addr.address">
                    <span class="address-option"
                      >{{ addr.address }}{{ getAddressDisplayLabel(addr) }}</span
                    >
                  </mat-option>
                }
              </mat-select>
            </mat-form-field>

            <!-- 2. Amount / 3. Label (feed the URI/QR) — desktop only; the
                 phone tier hides them to keep the page on one screen. -->
            <mat-form-field appearance="outline" class="full-width optional-field">
              <mat-label>{{ 'amount_optional' | i18n }}</mat-label>
              <input
                matInput
                type="number"
                [(ngModel)]="amount"
                placeholder="0.00000000"
                step="0.00000001"
                min="0"
                autocomplete="off"
              />
              <span matTextSuffix>BTCX</span>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width optional-field">
              <mat-label>{{ 'label_optional' | i18n }}</mat-label>
              <input
                matInput
                [(ngModel)]="label"
                [placeholder]="'label_placeholder' | i18n"
                maxlength="50"
                autocomplete="off"
              />
            </mat-form-field>

            <!-- 4. QR -->
            <div class="qr-section">
              <div class="qr-code-container">
                <qrcode
                  [qrdata]="paymentUri()"
                  [width]="200"
                  [errorCorrectionLevel]="'M'"
                  [margin]="1"
                  [colorDark]="'#1E3A5F'"
                  [colorLight]="'#FFFFFF'"
                ></qrcode>
              </div>

              <div class="info-row">
                <span class="info-label">{{ 'address' | i18n }}:</span>
                <div
                  class="info-value-row copyable"
                  (click)="copyAddress()"
                  [matTooltip]="'copy' | i18n"
                >
                  <span class="address-value">{{ selectedAddress() }}</span>
                  <mat-icon class="copy-icon">content_copy</mat-icon>
                </div>
              </div>

              <!-- 5. Payment URI -->
              <div class="info-row">
                <span class="info-label">{{ 'payment_uri' | i18n }}:</span>
                <div
                  class="info-value-row copyable"
                  (click)="copyPaymentUri()"
                  [matTooltip]="'copy' | i18n"
                >
                  <span class="uri-value">{{ paymentUri() }}</span>
                  <mat-icon class="copy-icon">content_copy</mat-icon>
                </div>
              </div>
            </div>

            <!-- 6. Generate new address -->
            @if (singleAddress()) {
              <!-- Remote single-address (wpkh-WIF) wallet: ONE fixed address,
                   nothing to generate — the button collapses to a hint. -->
              <p class="single-hint">{{ 'mwallet_receive_single_hint' | i18n }}</p>
            } @else {
              <div class="generate-row">
                <button
                  mat-stroked-button
                  (click)="generateNewAddress()"
                  [disabled]="isGenerating()"
                >
                  @if (isGenerating()) {
                    <mat-spinner diameter="18" class="button-spinner"></mat-spinner>
                  } @else {
                    <mat-icon>refresh</mat-icon>
                  }
                  {{ 'generate_new_address' | i18n }}
                </button>
              </div>
            }
          } @else if (loadError()) {
            <!-- The old mobile receive's failed-state with retry. -->
            <div class="no-address">
              <mat-icon>error_outline</mat-icon>
              <span>{{ 'mwallet_address_failed' | i18n }}</span>
              <button mat-stroked-button (click)="loadReceiveAddress()">
                <mat-icon>refresh</mat-icon>
                {{ 'retry' | i18n }}
              </button>
            </div>
          } @else {
            <div class="loading-inline">
              <mat-spinner diameter="20"></mat-spinner>
              <span>{{ 'loading_addresses' | i18n }}</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      @use 'breakpoints' as bp;

      :host {
        display: block;
        width: 100%;
      }

      .page-layout {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      /* Gradient band on the shared balance-band token (in tandem with the
         menu balance block; shrinks at the phone tier). */
      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        min-height: var(--menu-balance-h);
        box-sizing: border-box;
        padding: 0 24px;
        display: flex;
        align-items: center;
      }

      .single-hint {
        color: rgba(0, 0, 0, 0.55);
        font-size: 13px;
        text-align: center;
        margin: 0 0 12px;
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 16px;

        h1 {
          margin: 0;
          font-size: 20px;
          font-weight: 300;
        }
      }

      .back-button {
        color: rgba(255, 255, 255, 0.9);
      }

      .content {
        padding: 24px;
        display: flex;
        justify-content: center;
      }

      .receive-card {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        max-width: 560px;
        width: 100%;
        padding: 16px 20px;
        overflow: hidden;
        box-sizing: border-box;
      }

      .form-section {
        margin-bottom: 12px;
      }

      .full-width {
        width: 100%;
        /* The subscript wrapper is hidden (compact fields) — restore the
           stack gap explicitly so fields don't glue together. */
        margin-bottom: 12px;
      }

      .loading-inline {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 24px 0;
        color: #666;
        font-size: 13px;
      }

      /* Compact form fields */
      ::ng-deep {
        .mat-mdc-form-field-subscript-wrapper {
          display: none;
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

      /* QR Section */
      .address-option {
        font-family: monospace;
        font-size: 12px;
      }

      .qr-section {
        text-align: center;
        padding-top: 4px;
      }

      .qr-code-container {
        display: inline-block;
        padding: 12px;
        background: #fff;
        border-radius: 8px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
        margin-bottom: 16px;
      }

      .info-row {
        text-align: left;
        margin-bottom: 12px;

        .info-label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
        }
      }

      .info-value-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        background: #f5f7fa;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.2s;

        &:hover {
          background: #e8eef5;
        }

        .copy-icon {
          font-size: 18px;
          height: 18px;
          width: 18px;
          color: #1976d2;
          flex-shrink: 0;
          margin-left: 8px;
        }
      }

      .address-value {
        font-family: monospace;
        font-size: 14px;
        font-weight: 500;
        color: #002341;
        word-break: break-all;
        text-align: left;
        flex: 1;
      }

      .uri-value {
        font-family: monospace;
        font-size: 12px;
        color: #1976d2;
        word-break: break-all;
        text-align: left;
        flex: 1;
      }

      /* Generate new address */
      .generate-row {
        display: flex;
        justify-content: center;
        margin: 4px 0 16px;

        .button-spinner {
          display: inline-block;
          margin-right: 8px;
        }

        mat-icon {
          margin-right: 4px;
        }
      }

      /* Optional amount/label — visually secondary */
      .optional-fields {
        border-top: 1px solid #eee;
        padding-top: 12px;

        .form-section:last-child {
          margin-bottom: 0;
        }
      }

      /* Failed state */
      .no-address {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 32px 0;
        color: rgba(0, 0, 0, 0.38);

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
        }

        span {
          font-size: 13px;
        }
      }

      /* Spend-only (v30) block panel */
      .spend-only {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 12px;
        padding: 24px 12px;

        .spend-only-icon {
          font-size: 44px;
          width: 44px;
          height: 44px;
          color: #b26a00;
        }

        span {
          font-size: 14px;
          color: rgba(0, 0, 0, 0.7);
          line-height: 1.5;
          max-width: 360px;
        }
      }

      /* Dark theme */
      :host-context(.dark-theme) {
        .page-layout {
          background: #303030;
        }

        .receive-card {
          background: #424242;
        }

        .single-hint {
          color: rgba(255, 255, 255, 0.55);
        }

        .info-row .info-label {
          color: #aaa;
        }

        .info-value-row {
          background: #333;

          &:hover {
            background: #3a3a3a;
          }
        }

        .address-value {
          color: #90caf9;
        }

        .optional-fields {
          border-top-color: #555;
        }

        .no-address {
          color: rgba(255, 255, 255, 0.38);
        }

        .spend-only span {
          color: rgba(255, 255, 255, 0.7);
        }
      }

      /* Responsive */
      @include bp.phone {
        .header {
          padding: 0 16px;
        }

        /* Phone: no amount/label — the page stays on one screen; the URI
           falls back to the plain address. */
        .optional-field {
          display: none;
        }

        /* Compact phone rhythm: tighter page/card padding + section spacing. */
        .content {
          padding: 12px;
        }

        .receive-card {
          max-width: 480px;
          padding: 14px 16px;
        }

        .form-section {
          margin-bottom: 8px;
        }

        .address-option {
          font-family: monospace;
          font-size: 12px;
        }

        .qr-section {
          padding-top: 2px;
        }

        .generate-row {
          margin: 2px 0 12px;
        }
      }
    `,
  ],
})
export class ReceiveComponent implements OnInit, OnDestroy {
  private readonly walletManager = inject(WalletManagerService);
  private readonly clipboard = inject(ClipboardService);
  private readonly notification = inject(NotificationService);
  private readonly location = inject(Location);
  private readonly nodeService = inject(NodeService);
  private readonly btcxWallet = inject(BtcxWalletService);
  private readonly backendRouter = inject(BackendRouterService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly destroy$ = new Subject<void>();

  /**
   * Whether the current backend can enumerate the wallet's revealed
   * addresses (Core RPC). Remote/BDK lists only what the seam hands out
   * (current first-unused + freshly generated this session).
   */
  readonly canEnumerate = computed(() => !this.backendRouter.isRemote());

  /**
   * Remote (Electrum) mode + a legacy v30 (coin-0') pocket = spend-only:
   * receiving is blocked so funds never land back in the retired branch.
   * Only ever true in remote mode — managed/Core mode is unaffected.
   */
  readonly spendOnly = computed(
    () => this.nodeService.isRemote() && this.btcxWallet.descriptorPolicy()?.coinType === 0
  );

  /**
   * Remote single-address (wpkh-WIF) wallet: ONE fixed address, nothing to
   * generate — the generate button collapses to a hint (the old mobile
   * receive's mwallet_receive_single_hint behavior).
   */
  readonly singleAddress = computed(
    () => this.nodeService.isRemote() && this.btcxWallet.singleAddress()
  );

  /** Address load failed (e.g. wallet runtime briefly closed) — offer retry. */
  readonly loadError = signal(false);

  /** The SELECTED address (latest virgin preselected; history selectable). */
  readonly selectedAddress = signal('');
  readonly existingAddresses = signal<AddressInfo[]>([]);
  readonly isGenerating = signal(false);
  amount: number | null = null;
  label = '';

  paymentUri(): string {
    return buildPaymentUri({
      address: this.selectedAddress(),
      amount: this.amount,
      label: this.label,
    });
  }

  ngOnInit(): void {
    // Subscribe to wallet changes to reload the address. Switching INTO a
    // v30 pocket clears the shown address and derives nothing; switching
    // out reloads normally.
    this.walletManager.activeWallet$
      .pipe(
        skip(1), // Skip initial value since we already loaded
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.selectedAddress.set('');
        this.existingAddresses.set([]);
        this.loadError.set(false);
        if (!this.spendOnly()) {
          this.loadReceiveAddress();
        }
      });

    void this.init();
  }

  /**
   * Ensure the remote wallet config is loaded before deciding spend-only —
   * otherwise `descriptorPolicy()` is null on first paint and the guard
   * would fail open. Then derive the initial address (unless spend-only).
   */
  private async init(): Promise<void> {
    if (this.nodeService.isRemote()) {
      await this.btcxWallet.initialize();
    }
    if (!this.spendOnly()) {
      await this.loadReceiveAddress();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack(): void {
    this.location.back();
  }

  /**
   * Load the selector: the first VIRGIN (never-received) address is fetched
   * via the seam and PRESELECTED; Core mode additionally enumerates the
   * revealed history so older addresses stay reachable.
   */
  async loadReceiveAddress(): Promise<void> {
    if (this.spendOnly()) return;
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    this.loadError.set(false);
    try {
      const current = await this.backendRouter.wallet().currentReceiveAddress(walletName);
      if (this.canEnumerate()) {
        await this.loadExistingAddressList(walletName, current);
      } else {
        // Remote/BDK: enumerate every revealed external address locally
        // (used/funded flags from the synced graph) — newest first, same
        // as the Core list; the current first-unused is always present.
        const revealed = await this.btcxWallet.addresses();
        const list = revealed
          .sort((a, b) => b.index - a.index)
          .map(a => ({
            address: a.address,
            purpose: 'receive',
            isUsed: a.used || a.funded,
            txCount: 0,
            label: '',
          }));
        if (current && !list.some(a => a.address === current)) {
          list.unshift({
            address: current,
            purpose: 'receive',
            isUsed: false,
            txCount: 0,
            label: '',
          });
        }
        this.existingAddresses.set(list);
      }
      this.selectedAddress.set(current);
    } catch (error) {
      console.error('Failed to load address:', error);
      // Only surface the retry state when nothing usable is on screen.
      if (!this.selectedAddress()) this.loadError.set(true);
    }
  }

  /**
   * Build the Core existing-address list. isUsed reflects REAL on-chain
   * usage (received sats / txids from listreceivedbyaddress); ensure
   * guarantees the current first-unused is present so the selected value
   * always has a matching option.
   */
  private async loadExistingAddressList(walletName: string, ensure?: string): Promise<void> {
    let bookAddresses: string[] = [];
    try {
      const addressMap = await this.walletRpc.getAddressesByLabel(walletName, '');
      bookAddresses = Object.keys(addressMap);
    } catch {
      // A freshly reimported wallet may have an EMPTY address book — Core
      // errors on an unknown label. The descriptor path below still works.
    }

    const usage = new Map<string, { used: boolean; label: string }>();
    try {
      const received = await this.walletRpc.listReceivedByAddress(walletName, 0, true);
      for (const r of received) {
        usage.set(r.address, {
          used: Math.round(r.amount * 1e8) > 0 || r.txids.length > 0,
          label: r.label ?? '',
        });
      }
    } catch {
      // best-effort — used/label fall back to defaults below.
    }
    // listreceivedbyaddress is ADDRESS-BOOK-bound — on a reimported
    // descriptor wallet the book is empty, so FUNDED addresses are the
    // reliable usage signal (a mining wallet's whole history is here).
    try {
      const unspent = await this.walletRpc.listUnspent(walletName);
      for (const u of unspent) {
        if (!u.address) continue;
        const entry = usage.get(u.address);
        if (entry) entry.used = true;
        else usage.set(u.address, { used: true, label: '' });
      }
    } catch {
      // best-effort
    }

    // Seed from the wallet's own DESCRIPTORS, not just Core's address book:
    // a reimported descriptor wallet knows its chains even though no
    // addresses were ever handed out via getnewaddress here.
    // - ACTIVE external chains (current coin type): derive the issued
    //   range 0..next-1.
    // - INACTIVE external chains (the legacy coin-0 sets a restore imports
    //   watch-only): they issue nothing, so derive their imported range
    //   (capped) and keep only addresses with REAL usage — the wallet's
    //   past addresses.
    const derived = new Set<string>(bookAddresses);
    const legacy = new Set<string>();
    try {
      const { descriptors } = await this.walletRpc.listDescriptors(walletName);
      for (const d of descriptors) {
        if (d.internal) continue; // explicit change chains out
        if (!d.desc.startsWith('wpkh(')) continue; // bech32 receive chains only
        // Core tracks the issued range (next) even for INACTIVE imported
        // legacy chains — those addresses were handed out at some point, so
        // include them all. Beyond that, scan the (capped) imported range
        // and keep only addresses with real usage (funded — the book is
        // empty right after a reimport). NOTE: legacy imports carry no
        // internal flag, so their change chain is scanned too — its used
        // addresses are legitimate history.
        const next = d.next ?? 0;
        const start = d.range?.[0] ?? 0;
        const end = Math.min(d.range?.[1] ?? next - 1, start + 299);
        if (end < start && next <= 0) continue;
        const scanEnd = Math.max(end, next - 1);
        if (scanEnd < start) continue;
        const addrs = await this.walletRpc.deriveAddresses(d.desc, [start, scanEnd]);
        addrs.forEach((a, i) => {
          const index = start + i;
          // ACTIVE chain: every issued address (incl. the current virgin).
          // INACTIVE legacy chains: USED addresses only — never offer a
          // never-used legacy address for receiving (the retired chain).
          if ((d.active && index < next) || usage.get(a)?.used) {
            derived.add(a);
            if (!d.active) legacy.add(a);
          }
        });
      }
    } catch {
      // Pre-descriptor wallet — the address book is all there is.
    }

    const addresses: AddressInfo[] = [];
    for (const address of derived) {
      if (!this.isBech32Address(address)) continue;
      const u = usage.get(address);
      addresses.push({
        address,
        purpose: 'receive',
        isUsed: u?.used ?? false,
        txCount: 0,
        label: u?.label ?? '',
        isLegacy: legacy.has(address),
      });
    }

    if (ensure && !addresses.some(a => a.address === ensure)) {
      addresses.unshift({
        address: ensure,
        purpose: 'receive',
        isUsed: false,
        txCount: 0,
        label: '',
      });
    }

    this.existingAddresses.set(addresses);
  }

  /** A bech32(m) address for the PoCX networks (not legacy/script). */
  private isBech32Address(address: string): boolean {
    const lower = address.toLowerCase();
    return (
      lower.startsWith('pocx1') ||
      lower.startsWith('tpocx1') ||
      lower.startsWith('rpocx1') ||
      lower.startsWith('bc1') ||
      lower.startsWith('tb1') ||
      lower.startsWith('bcrt1')
    );
  }

  /** Selector suffix: label + never-used hint, matching the old dropdown. */
  getAddressDisplayLabel(addr: AddressInfo): string {
    const parts: string[] = [];
    if (addr.label) parts.push(addr.label);
    if (addr.isLegacy) parts.push('v30');
    if (addr.purpose === 'receive' && !addr.isUsed) parts.push('never used');
    return parts.length > 0 ? ' (' + parts.join(' - ') + ')' : '';
  }

  async generateNewAddress(): Promise<void> {
    if (this.spendOnly() || this.singleAddress() || this.isGenerating()) return;
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    this.isGenerating.set(true);
    try {
      const address = await this.backendRouter
        .wallet()
        .getNewAddress(walletName, this.label || '', 'bech32');
      if (this.canEnumerate()) {
        // Core: refresh the list so the freshly revealed address shows.
        await this.loadExistingAddressList(walletName, address);
      } else {
        this.existingAddresses.update(list => [
          { address, purpose: 'receive', isUsed: false, txCount: 0, label: '' },
          ...list,
        ]);
      }
      this.selectedAddress.set(address);
    } catch (error) {
      console.error('Failed to generate address:', error);
      this.notification.error('error_generating_address');
    } finally {
      this.isGenerating.set(false);
    }
  }

  async copyAddress(): Promise<void> {
    const address = this.selectedAddress();
    if (address) await this.clipboard.copyAddress(address);
  }

  async copyPaymentUri(): Promise<void> {
    const uri = this.paymentUri();
    if (uri) {
      await this.clipboard.copy(uri);
      this.notification.success('payment_uri_copied');
    }
  }
}
