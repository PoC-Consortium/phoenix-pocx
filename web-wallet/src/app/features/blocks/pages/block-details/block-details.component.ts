import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { Subject } from 'rxjs';
import { I18nPipe } from '../../../../core/i18n';
import { ClipboardService, BlockExplorerService } from '../../../../shared/services';
import { BlockchainRpcService } from '../../../../bitcoin/services/rpc/blockchain-rpc.service';
import { PocxBlock } from '../../models/block.model';

@Component({
  selector: 'app-block-details',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDividerModule,
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
          <h1>{{ 'block_details' | i18n }}</h1>
        </div>
        <div class="header-right">
          @if (block()) {
            <span class="block-height">#{{ block()!.height }}</span>
          }
        </div>
      </div>

      <!-- Content -->
      <div class="content">
        @if (loading()) {
          <div class="loading-container">
            <mat-spinner diameter="48"></mat-spinner>
            <p>{{ 'loading_block' | i18n }}</p>
          </div>
        } @else if (error()) {
          <div class="error-container">
            <mat-icon>error</mat-icon>
            <p>{{ error() }}</p>
            <button mat-stroked-button (click)="goBack()">{{ 'go_back' | i18n }}</button>
          </div>
        } @else if (block()) {
          <!-- Block Info Section -->
          <mat-card class="detail-card">
            <mat-card-header>
              <mat-card-title>{{ 'block_info' | i18n }}</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <div class="detail-row">
                <span class="label">{{ 'hash' | i18n }}</span>
                <div class="value hash-value">
                  <span (click)="copyToClipboard(block()!.hash)" [matTooltip]="'copy' | i18n">{{
                    block()!.hash
                  }}</span>
                  <mat-icon
                    class="copy-icon"
                    (click)="copyToClipboard(block()!.hash)"
                    [matTooltip]="'copy' | i18n"
                    >content_copy</mat-icon
                  >
                  <mat-icon
                    class="explorer-icon"
                    (click)="openBlockInExplorer(block()!.hash)"
                    [matTooltip]="'view_block_in_explorer' | i18n"
                    >open_in_new</mat-icon
                  >
                </div>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'height' | i18n }}</span>
                <span class="value">{{ block()!.height }}</span>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'confirmations' | i18n }}</span>
                <span class="value">{{ block()!.confirmations }}</span>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'timestamp' | i18n }}</span>
                <span class="value">{{ formatDate(block()!.time) }}</span>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'time_since_last_block' | i18n }}</span>
                <span class="value">{{ block()!.time_since_last_block }}s</span>
              </div>
            </mat-card-content>
          </mat-card>

          <!-- PoC Info Section -->
          <mat-card class="detail-card">
            <mat-card-header>
              <mat-card-title>{{ 'poc_info' | i18n }}</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <div class="detail-row">
                <span class="label">{{ 'forger_address' | i18n }}</span>
                <div class="value hash-value">
                  <span
                    (click)="copyToClipboard(block()!.signer_address)"
                    [matTooltip]="'copy' | i18n"
                    >{{ block()!.signer_address }}</span
                  >
                  <mat-icon
                    class="copy-icon"
                    (click)="copyToClipboard(block()!.signer_address)"
                    [matTooltip]="'copy' | i18n"
                    >content_copy</mat-icon
                  >
                  <mat-icon
                    class="explorer-icon"
                    (click)="openAddressInExplorer(block()!.signer_address)"
                    [matTooltip]="'view_address_in_explorer' | i18n"
                    >open_in_new</mat-icon
                  >
                </div>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'base_target' | i18n }}</span>
                <span class="value mono">{{ block()!.base_target }}</span>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'difficulty' | i18n }}</span>
                <span class="value mono">{{ block()!.difficulty.toFixed(4) }}</span>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'generation_signature' | i18n }}</span>
                <div
                  class="value hash-value small"
                  (click)="copyToClipboard(block()!.generation_signature)"
                  [matTooltip]="'copy' | i18n"
                >
                  <span>{{ block()!.generation_signature }}</span>
                  <mat-icon class="copy-icon">content_copy</mat-icon>
                </div>
              </div>
            </mat-card-content>
          </mat-card>

          <!-- PoCX Proof Section -->
          @if (block()!.pocx_proof) {
            <mat-card class="detail-card">
              <mat-card-header>
                <mat-card-title>{{ 'pocx_proof' | i18n }}</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <div class="detail-row">
                  <span class="label">{{ 'account_id' | i18n }}</span>
                  <span class="value mono">{{ block()!.pocx_proof.account_id }}</span>
                </div>
                <div class="detail-row">
                  <span class="label">{{ 'nonce' | i18n }}</span>
                  <span class="value mono">{{ block()!.pocx_proof.nonce }}</span>
                </div>
                <div class="detail-row">
                  <span class="label">{{ 'quality' | i18n }}</span>
                  <span class="value mono">{{ formatQuality(block()!.pocx_proof.quality) }}</span>
                </div>
                <div class="detail-row">
                  <span class="label">{{ 'compression' | i18n }}</span>
                  <span class="value mono">{{ block()!.pocx_proof.compression }}</span>
                </div>
                <div class="detail-row">
                  <span class="label">{{ 'seed' | i18n }}</span>
                  <div
                    class="value hash-value small"
                    (click)="copyToClipboard(block()!.pocx_proof.seed)"
                    [matTooltip]="'copy' | i18n"
                  >
                    <span>{{ block()!.pocx_proof.seed }}</span>
                    <mat-icon class="copy-icon">content_copy</mat-icon>
                  </div>
                </div>
              </mat-card-content>
            </mat-card>
          }

          <!-- Chain Links Section -->
          <mat-card class="detail-card">
            <mat-card-header>
              <mat-card-title>{{ 'chain_links' | i18n }}</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <div class="detail-row">
                <span class="label">{{ 'previous_block' | i18n }}</span>
                @if (block()!.previousblockhash) {
                  <div
                    class="value link-value"
                    (click)="navigateToBlock(block()!.previousblockhash!)"
                  >
                    <span>{{ block()!.previousblockhash }}</span>
                    <mat-icon class="link-icon">arrow_back</mat-icon>
                  </div>
                } @else {
                  <span class="value muted">{{ 'genesis_block' | i18n }}</span>
                }
              </div>
              <div class="detail-row">
                <span class="label">{{ 'next_block' | i18n }}</span>
                @if (block()!.nextblockhash) {
                  <div class="value link-value" (click)="navigateToBlock(block()!.nextblockhash!)">
                    <span>{{ block()!.nextblockhash }}</span>
                    <mat-icon class="link-icon">arrow_forward</mat-icon>
                  </div>
                } @else {
                  <span class="value muted">{{ 'latest_block' | i18n }}</span>
                }
              </div>
            </mat-card-content>
          </mat-card>

          <!-- Technical Info Section -->
          <mat-card class="detail-card">
            <mat-card-header>
              <mat-card-title>{{ 'technical_info' | i18n }}</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <div class="detail-row">
                <span class="label">{{ 'merkle_root' | i18n }}</span>
                <div
                  class="value hash-value small"
                  (click)="copyToClipboard(block()!.merkleroot)"
                  [matTooltip]="'copy' | i18n"
                >
                  <span>{{ block()!.merkleroot }}</span>
                  <mat-icon class="copy-icon">content_copy</mat-icon>
                </div>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'version' | i18n }}</span>
                <span class="value mono">{{ block()!.version }} ({{ block()!.versionHex }})</span>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'size' | i18n }}</span>
                <span class="value">{{ formatSize(block()!.size) }}</span>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'weight' | i18n }}</span>
                <span class="value">{{ block()!.weight.toLocaleString() }} WU</span>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'chainwork' | i18n }}</span>
                <div
                  class="value hash-value small"
                  (click)="copyToClipboard(block()!.chainwork)"
                  [matTooltip]="'copy' | i18n"
                >
                  <span>{{ block()!.chainwork }}</span>
                  <mat-icon class="copy-icon">content_copy</mat-icon>
                </div>
              </div>
            </mat-card-content>
          </mat-card>

          <!-- Transactions Section -->
          <mat-card class="detail-card">
            <mat-card-header>
              <mat-card-title
                >{{ 'transactions' | i18n }} ({{ getTransactionCount() }})</mat-card-title
              >
            </mat-card-header>
            <mat-card-content>
              <div class="transactions-list">
                @for (txid of getTransactionIds(); track txid; let i = $index) {
                  <div class="tx-row">
                    <span class="tx-index">{{ i }}</span>
                    <span
                      class="tx-id"
                      (click)="copyToClipboard(txid)"
                      [matTooltip]="'click_to_copy' | i18n"
                      >{{ txid }}</span
                    >
                    <mat-icon
                      class="explorer-icon"
                      (click)="openTransactionInExplorer(txid)"
                      [matTooltip]="'view_tx_in_explorer' | i18n"
                      >open_in_new</mat-icon
                    >
                  </div>
                }
              </div>
            </mat-card-content>
          </mat-card>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .page-layout {
        min-height: 100vh;
        background: #f5f5f5;
      }

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

        .back-button {
          color: white;
        }
      }

      .header-right {
        .block-height {
          font-family: monospace;
          font-size: 18px;
          font-weight: 600;
          background: rgba(255, 255, 255, 0.1);
          padding: 8px 16px;
          border-radius: 20px;
        }
      }

      .content {
        padding: 24px;
        max-width: 900px;
        margin: 0 auto;
      }

      .loading-container,
      .error-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 64px;
        color: rgba(0, 0, 0, 0.54);

        mat-icon {
          font-size: 64px;
          width: 64px;
          height: 64px;
          margin-bottom: 16px;
        }

        p {
          margin-bottom: 16px;
        }
      }

      .error-container {
        mat-icon {
          color: #f44336;
        }
      }

      .detail-card {
        margin-bottom: 16px;

        mat-card-header {
          padding: 16px 16px 0;

          mat-card-title {
            font-size: 14px;
            font-weight: 600;
            color: #002341;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
        }

        mat-card-content {
          padding: 16px;
        }
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid #f0f0f0;

        &:last-child {
          border-bottom: none;
        }

        .label {
          font-size: 13px;
          color: #666;
          flex-shrink: 0;
          margin-right: 16px;
        }

        .value {
          font-size: 13px;
          color: #002341;
          text-align: right;
          word-break: break-all;

          &.mono {
            font-family: monospace;
          }

          &.muted {
            color: #999;
            font-style: italic;
          }
        }

        .hash-value {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          color: #1976d2;
          font-family: monospace;
          font-size: 13px;

          &:hover {
            color: #1565c0;
          }

          &.small {
            font-size: 12px;
          }

          .copy-icon,
          .explorer-icon {
            font-size: 16px;
            width: 16px;
            height: 16px;
            opacity: 0.7;
            cursor: pointer;

            &:hover {
              opacity: 1;
            }
          }
        }

        .link-value {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          color: #1976d2;
          font-family: monospace;
          font-size: 13px;

          &:hover {
            color: #1565c0;
            text-decoration: underline;
          }

          .link-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
          }
        }
      }

      .transactions-list {
        max-height: 400px;
        overflow-y: auto;

        .tx-row {
          display: flex;
          align-items: center;
          padding: 10px 12px;
          border-radius: 4px;
          cursor: pointer;
          transition: background 0.2s;

          &:hover {
            background: #f5f7fa;
          }

          .tx-index {
            width: 40px;
            font-size: 12px;
            color: #999;
          }

          .tx-id {
            flex: 1;
            font-family: monospace;
            font-size: 12px;
            color: #1976d2;
            word-break: break-all;
            cursor: pointer;

            &:hover {
              text-decoration: underline;
            }
          }
        }
      }

      /* Dark theme */
      :host-context(.dark-theme) {
        .page-layout {
          background: #303030;
        }

        .detail-card {
          background: #424242;

          mat-card-title {
            color: #90caf9;
          }
        }

        .detail-row {
          border-bottom-color: #555;

          .label {
            color: #aaa;
          }

          .value {
            color: #fff;

            &.muted {
              color: #888;
            }
          }

          .hash-value,
          .link-value {
            color: #90caf9;

            &:hover {
              color: #bbdefb;
            }
          }
        }

        .transactions-list .tx-row {
          &:hover {
            background: #333;
          }

          .tx-id {
            color: #90caf9;
          }
        }
      }
    `,
  ],
})
export class BlockDetailsComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly clipboard = inject(ClipboardService);
  private readonly blockExplorer = inject(BlockExplorerService);
  private readonly destroy$ = new Subject<void>();

  loading = signal(true);
  error = signal<string | null>(null);
  block = signal<PocxBlock | null>(null);

  ngOnInit(): void {
    const hashOrHeight = this.route.snapshot.paramMap.get('hashOrHeight');
    if (hashOrHeight) {
      this.loadBlock(hashOrHeight);
    } else {
      this.error.set('No block identifier provided');
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack(): void {
    this.location.back();
  }

  async loadBlock(hashOrHeight: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      let block: PocxBlock;

      // Check if it's a height (numeric) or hash
      if (/^\d+$/.test(hashOrHeight)) {
        const height = parseInt(hashOrHeight, 10);
        block = await this.blockchainRpc.getBlockByHeight<PocxBlock>(height, 1);
      } else {
        block = (await this.blockchainRpc.getBlock(hashOrHeight, 1)) as unknown as PocxBlock;
      }

      this.block.set(block);
    } catch (err) {
      console.error('Failed to load block:', err);
      this.error.set('Failed to load block. It may not exist or the node is unavailable.');
    } finally {
      this.loading.set(false);
    }
  }

  navigateToBlock(hash: string): void {
    this.router.navigate(['/blocks', hash]);
    this.loadBlock(hash);
  }

  viewTransaction(txid: string): void {
    this.router.navigate(['/blocks/tx', txid]);
  }

  copyToClipboard(text: string): void {
    this.clipboard.copy(text);
  }

  formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString();
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} bytes`;
    return `${(bytes / 1024).toFixed(2)} KB`;
  }

  formatQuality(quality: number): string {
    return quality.toLocaleString();
  }

  truncateHash(hash: string, startChars = 16, endChars = 12): string {
    if (!hash || hash.length <= startChars + endChars + 3) return hash;
    return `${hash.slice(0, startChars)}...${hash.slice(-endChars)}`;
  }

  getTransactionCount(): number {
    const b = this.block();
    if (!b) return 0;
    return Array.isArray(b.tx) ? b.tx.length : b.nTx;
  }

  getTransactionIds(): string[] {
    const b = this.block();
    if (!b || !b.tx) return [];

    return b.tx.map(tx => {
      if (typeof tx === 'string') return tx;
      return tx.txid;
    });
  }

  openBlockInExplorer(hash: string): void {
    this.blockExplorer.openBlock(hash);
  }

  openAddressInExplorer(address: string): void {
    this.blockExplorer.openAddress(address);
  }

  openTransactionInExplorer(txid: string): void {
    this.blockExplorer.openTransaction(txid);
  }
}
