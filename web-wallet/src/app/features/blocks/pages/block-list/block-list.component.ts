import { Component, inject, signal, OnInit, OnDestroy, computed, effect } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { Subject } from 'rxjs';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { BlockchainStateService } from '../../../../bitcoin/services/blockchain-state.service';
import { BlocksCacheService } from '../../services/blocks-cache.service';
import {
  BlockExplorerService,
  ClipboardService,
  NotificationService,
} from '../../../../shared/services';
import { UnixDatePipe, TimeAgoPipe, ByteSizePipe } from '../../../../shared/pipes';
import { PocxBlock, BLOCK_COUNT_OPTIONS } from '../../models/block.model';

@Component({
  selector: 'app-block-list',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatPaginatorModule,
    MatTooltipModule,
    MatMenuModule,
    MatDividerModule,
    I18nPipe,
    UnixDatePipe,
    TimeAgoPipe,
    ByteSizePipe,
  ],
  template: `
    <div class="page-layout">
      <!-- Header -->
      <div class="header">
        <div class="header-left">
          <button mat-icon-button class="back-button" (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h1>{{ 'blocks' | i18n }}</h1>
        </div>
        <div class="header-right">
          <div class="count-buttons">
            @for (option of countOptions; track option.value) {
              <button
                mat-stroked-button
                [class.active]="selectedCount === option.value"
                (click)="selectCount(option.value)"
                [disabled]="loading()"
              >
                {{ option.label }}
              </button>
            }
          </div>
          <button
            mat-icon-button
            [disabled]="loading()"
            (click)="loadBlocks()"
            [matTooltip]="'refresh' | i18n"
            class="refresh-button"
          >
            <mat-icon>refresh</mat-icon>
          </button>
        </div>
      </div>

      <!-- Content -->
      <mat-card class="blocks-card">
        <mat-card-content>
          @if (loading()) {
            <div class="loading-container">
              <mat-spinner diameter="48"></mat-spinner>
              <p>{{ 'loading_blocks' | i18n }}</p>
            </div>
          } @else if (blocks().length === 0) {
            <div class="empty-state">
              <mat-icon>apps</mat-icon>
              <p>{{ 'no_blocks_found' | i18n }}</p>
            </div>
          } @else {
            <div class="table-container">
              <table class="blocks-table">
                <thead>
                  <tr>
                    <th class="col-height">{{ 'height' | i18n }}</th>
                    <th class="col-hash">{{ 'hash' | i18n }}</th>
                    <th class="col-time">{{ 'time' | i18n }}</th>
                    <th class="col-forger">{{ 'forger' | i18n }}</th>
                    <th class="col-txs">{{ 'txs' | i18n }}</th>
                    <th class="col-size">{{ 'size' | i18n }}</th>
                    <th class="col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (block of paginatedBlocks(); track block.hash) {
                    <tr class="block-row">
                      <td class="col-height">
                        <a class="link" (click)="viewBlock(block)">{{ block.height }}</a>
                      </td>
                      <td class="col-hash">
                        <a class="link" (click)="viewBlock(block)">{{ block.hash }}</a>
                      </td>
                      <td class="col-time">
                        <span [matTooltip]="block.time | unixDate">{{
                          block.time | timeAgo
                        }}</span>
                      </td>
                      <td class="col-forger">{{ block.signer_address || '-' }}</td>
                      <td class="col-txs">{{ block.nTx }}</td>
                      <td class="col-size">{{ block.size | byteSize }}</td>
                      <td class="col-actions">
                        <button mat-icon-button [matMenuTriggerFor]="blockMenu">
                          <mat-icon>more_vert</mat-icon>
                        </button>
                        <mat-menu #blockMenu="matMenu">
                          <button mat-menu-item (click)="copyToClipboard(block.hash)">
                            <mat-icon>file_copy</mat-icon>
                            <span>{{ 'copy_block_hash' | i18n }}</span>
                          </button>
                          @if (block.signer_address) {
                            <button
                              mat-menu-item
                              (click)="copyToClipboard(block.signer_address)"
                            >
                              <mat-icon>file_copy</mat-icon>
                              <span>{{ 'copy_forger_address' | i18n }}</span>
                            </button>
                          }
                          <mat-divider></mat-divider>
                          <button mat-menu-item (click)="openBlockInExplorer(block.hash)">
                            <mat-icon>open_in_new</mat-icon>
                            <span>{{ 'view_block_in_explorer' | i18n }}</span>
                          </button>
                          @if (block.signer_address) {
                            <button
                              mat-menu-item
                              (click)="openAddressInExplorer(block.signer_address)"
                            >
                              <mat-icon>open_in_new</mat-icon>
                              <span>{{ 'view_forger_in_explorer' | i18n }}</span>
                            </button>
                          }
                        </mat-menu>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <mat-paginator
              [length]="blocks().length"
              [pageSize]="pageSize()"
              [pageIndex]="pageIndex()"
              [pageSizeOptions]="pageSizeOptions"
              (page)="onPageChange($event)"
              [showFirstLastButtons]="true"
            ></mat-paginator>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .page-layout {
        display: flex;
        flex-direction: column;
        height: 100%;
        box-sizing: border-box;
        background: #eaf0f6;
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
        display: flex;
        align-items: center;
        gap: 12px;

        .count-buttons {
          display: flex;
          gap: 4px;

          button {
            color: white;
            border-color: rgba(255, 255, 255, 0.4);
            min-width: 48px;
            height: 32px;
            line-height: 32px;
            padding: 0 12px;
            font-size: 13px;

            &.active {
              background: rgba(255, 255, 255, 0.2);
              border-color: white;
            }

            &:hover:not(:disabled) {
              background: rgba(255, 255, 255, 0.1);
            }

            &:disabled {
              color: rgba(255, 255, 255, 0.5);
              border-color: rgba(255, 255, 255, 0.2);
            }
          }
        }

        .refresh-button {
          color: white;

          &:disabled {
            color: rgba(255, 255, 255, 0.5);
          }
        }
      }

      .blocks-card {
        margin: 16px;
        background: #ffffff !important;
        border-radius: 8px;
        overflow: hidden;

        mat-card-content {
          padding: 16px 16px 0 16px !important;
        }
      }

      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 64px;
        color: rgba(0, 0, 0, 0.54);

        p {
          margin-top: 16px;
        }
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 64px;
        color: rgba(0, 0, 0, 0.38);

        mat-icon {
          font-size: 64px;
          width: 64px;
          height: 64px;
          margin-bottom: 16px;
        }
      }

      .table-container {
        overflow: auto;
      }

      .blocks-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;

        thead {
          th {
            padding: 6px 8px;
            text-align: left;
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            color: rgb(0, 35, 65);
            border-bottom: 1px solid #d0d0e0;
            white-space: nowrap;
            background: transparent;
          }
        }

        tbody {
          .block-row {
            td {
              padding: 8px;
              border-bottom: 1px solid #e8e8e8;
              vertical-align: middle;
              color: rgb(0, 35, 65);
            }
          }

          .link {
            cursor: pointer;
            text-decoration: none;
            color: #1565c0;

            &:hover {
              text-decoration: underline;
              color: #0d47a1;
            }
          }

          .col-height {
            font-weight: 500;
          }

          .col-hash {
            font-family: monospace;
            font-size: 11px;
          }

          .col-time {
            color: #666;
          }

          .col-forger {
            font-family: monospace;
            font-size: 11px;
            color: #1565c0;
          }

          .col-txs,
          .col-size {
            text-align: center;
          }

          .col-actions {
            width: 40px;
            text-align: center;

            button {
              color: #666666;
              width: 32px;
              height: 32px;
              padding: 0;

              mat-icon {
                font-size: 20px;
                width: 20px;
                height: 20px;
                line-height: 20px;
              }

              &:hover {
                color: rgb(0, 35, 65);
              }
            }
          }
        }
      }

      mat-paginator {
        background: transparent;
        margin-top: 0;

        ::ng-deep {
          .mat-mdc-paginator-container {
            color: #888888;
            min-height: 40px;
            padding: 0;
            align-items: center;
          }

          .mat-mdc-paginator-page-size {
            align-items: center;
          }

          .mat-mdc-paginator-page-size-label,
          .mat-mdc-paginator-range-label {
            color: #888888;
            font-size: 12px;
          }

          .mat-mdc-paginator-page-size-select {
            width: 56px;
            margin: 0 4px;

            .mat-mdc-text-field-wrapper {
              padding: 0 4px;

              .mat-mdc-form-field-flex {
                height: 32px;
                align-items: center;
              }

              .mdc-notched-outline__leading,
              .mdc-notched-outline__notch,
              .mdc-notched-outline__trailing {
                border: none !important;
              }

              .mat-mdc-form-field-infix {
                padding: 0;
                min-height: 32px;
                display: flex;
                align-items: center;
              }
            }
          }

          .mat-mdc-select-value,
          .mat-mdc-select-arrow {
            color: #666666 !important;
          }

          .mat-mdc-icon-button {
            color: #666666;
            width: 32px;
            height: 32px;
            padding: 4px;

            &:hover:not(:disabled) {
              color: #333333;
            }

            &:disabled {
              color: #cccccc;
            }

            .mat-mdc-paginator-icon {
              width: 20px;
              height: 20px;
            }
          }
        }
      }

      /* Dark theme */
      :host-context(.dark-theme) {
        .page-layout {
          background: #303030;
        }

        .blocks-card {
          background: #424242 !important;
        }

        .blocks-table {
          thead th {
            color: #fff;
            border-bottom-color: #555;
          }

          tbody {
            .block-row td {
              color: #ddd;
              border-bottom-color: #555;
            }

            .link {
              color: #90caf9;

              &:hover {
                color: #bbdefb;
              }
            }

            .col-forger {
              color: #90caf9;
            }

            .col-time {
              color: #aaa;
            }

            .col-actions button {
              color: #aaa;

              &:hover {
                color: #fff;
              }
            }
          }
        }
      }
    `,
  ],
})
export class BlockListComponent implements OnInit, OnDestroy {
  private readonly cache = inject(BlocksCacheService);
  private readonly blockchainState = inject(BlockchainStateService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly blockExplorer = inject(BlockExplorerService);
  private readonly clipboard = inject(ClipboardService);
  private readonly notification = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly destroy$ = new Subject<void>();

  readonly loading = this.cache.loading;
  readonly blocks = this.cache.recentBlocks;
  pageIndex = signal(0);
  pageSize = signal(10);
  pageSizeOptions = [10, 25, 50];

  countOptions = BLOCK_COUNT_OPTIONS;
  selectedCount = 180; // Default 6h

  paginatedBlocks = computed(() => {
    const allBlocks = this.blocks();
    const start = this.pageIndex() * this.pageSize();
    return allBlocks.slice(start, start + this.pageSize());
  });

  private lastAutoLoadHeight = 0;

  constructor() {
    // Auto-refresh when the chain tip actually moves. `lastAutoLoadHeight` gates
    // against same-value signal writes (would otherwise fan out into duplicate
    // loads on every mount because effect + ngOnInit both fired).
    effect(() => {
      const height = this.blockchainState.blockHeight();
      if (height === 0 || height === this.lastAutoLoadHeight) return;
      this.lastAutoLoadHeight = height;
      this.triggerLoad(this.selectedCount);
    });
  }

  ngOnInit(): void {
    // effect already handles initial load once blockHeight is known. For a cold
    // boot where blockHeight has not been fetched yet, kick it off ourselves.
    if (this.blockchainState.blockHeight() === 0) {
      this.triggerLoad(this.selectedCount);
    }
  }

  private triggerLoad(count: number): void {
    this.cache.loadRecent(count).catch(err => {
      console.error('Failed to load blocks:', err);
      this.notification.error(this.i18n.get('failed_to_load_blocks'));
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack(): void {
    this.location.back();
  }

  selectCount(count: number): void {
    if (this.selectedCount !== count) {
      this.selectedCount = count;
      this.pageIndex.set(0);
      this.triggerLoad(count);
    }
  }

  async loadBlocks(): Promise<void> {
    try {
      await this.cache.forceReload(this.selectedCount);
    } catch {
      this.notification.error(this.i18n.get('failed_to_load_blocks'));
    }
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }

  viewBlock(block: PocxBlock): void {
    this.router.navigate(['/blocks', block.hash]);
  }

  openBlockInExplorer(hash: string): void {
    this.blockExplorer.openBlock(hash);
  }

  openAddressInExplorer(address: string): void {
    this.blockExplorer.openAddress(address);
  }

  copyToClipboard(text: string): void {
    this.clipboard.copy(text);
  }
}
