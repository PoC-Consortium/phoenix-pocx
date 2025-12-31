import {
  Component,
  inject,
  signal,
  OnInit,
  OnDestroy,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Location } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject } from 'rxjs';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import {
  BlockchainRpcService,
  PeerInfo,
} from '../../../../bitcoin/services/rpc/blockchain-rpc.service';

/**
 * PeersComponent displays connected network peers.
 *
 * Features:
 * - Table with sorting and pagination
 * - Network badge (IPv4, IPv6, Onion, I2P, CJDNS)
 * - Version comparison with color coding
 * - Connection duration formatting
 * - Bytes transferred formatting
 */
@Component({
  selector: 'app-peers',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    I18nPipe,
    DecimalPipe,
  ],
  template: `
    <div class="page-layout">
      <!-- Header with gradient background -->
      <div class="header">
        <div class="header-left">
          <button mat-icon-button class="back-button" (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h1>{{ 'peers' | i18n }}</h1>
        </div>
        <div class="header-right">
          <span class="peer-count">{{ peers().length }} {{ 'peers_connected' | i18n }}</span>
          <button mat-icon-button (click)="refresh()" [matTooltip]="'refresh' | i18n">
            <mat-icon [class.spinning]="isLoading()">refresh</mat-icon>
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="content">
        <!-- Loading state -->
        @if (isLoading() && peers().length === 0) {
          <div class="loading-container">
            <mat-spinner diameter="40"></mat-spinner>
            <p>{{ 'loading' | i18n }}...</p>
          </div>
        }

        <!-- Error state -->
        @if (error()) {
          <div class="error-message">
            <mat-icon>error</mat-icon>
            <span>{{ error() }}</span>
          </div>
        }

        <!-- Peers table -->
        @if (!isLoading() || peers().length > 0) {
          <div class="peers-card">
            <div class="peers-table-container">
              <table mat-table [dataSource]="dataSource" matSort class="peers-table">
                <!-- Address Column -->
                <ng-container matColumnDef="addr">
                  <th mat-header-cell *matHeaderCellDef mat-sort-header>{{ 'address' | i18n }}</th>
                  <td mat-cell *matCellDef="let peer">
                    <div class="peer-address">
                      <span class="addr">{{ peer.addr }}</span>
                      <span class="network-badge" [class]="peer.network">{{ peer.network }}</span>
                    </div>
                  </td>
                </ng-container>

                <!-- Version Column -->
                <ng-container matColumnDef="subver">
                  <th mat-header-cell *matHeaderCellDef mat-sort-header>{{ 'version' | i18n }}</th>
                  <td mat-cell *matCellDef="let peer">
                    <div [class]="getVersionClass(peer)">
                      <span>{{ peer.subver || '???' }}</span>
                    </div>
                  </td>
                </ng-container>

                <!-- Connection Type Column -->
                <ng-container matColumnDef="connection_type">
                  <th mat-header-cell *matHeaderCellDef mat-sort-header>{{ 'type' | i18n }}</th>
                  <td mat-cell *matCellDef="let peer">
                    <span class="connection-type" [class.inbound]="peer.inbound">
                      {{ peer.inbound ? ('inbound' | i18n) : ('outbound' | i18n) }}
                    </span>
                  </td>
                </ng-container>

                <!-- Synced Blocks Column -->
                <ng-container matColumnDef="synced_blocks">
                  <th mat-header-cell *matHeaderCellDef mat-sort-header>
                    {{ 'synced_blocks' | i18n }}
                  </th>
                  <td mat-cell *matCellDef="let peer">
                    {{ peer.synced_blocks | number }}
                  </td>
                </ng-container>

                <!-- Downloaded Column -->
                <ng-container matColumnDef="bytesrecv">
                  <th mat-header-cell *matHeaderCellDef mat-sort-header>
                    {{ 'downloaded' | i18n }}
                  </th>
                  <td mat-cell *matCellDef="let peer">
                    {{ formatBytes(peer.bytesrecv) }}
                  </td>
                </ng-container>

                <!-- Uploaded Column -->
                <ng-container matColumnDef="bytessent">
                  <th mat-header-cell *matHeaderCellDef mat-sort-header>{{ 'uploaded' | i18n }}</th>
                  <td mat-cell *matCellDef="let peer">
                    {{ formatBytes(peer.bytessent) }}
                  </td>
                </ng-container>

                <!-- Connected Since Column -->
                <ng-container matColumnDef="conntime">
                  <th mat-header-cell *matHeaderCellDef mat-sort-header>
                    {{ 'connected_since' | i18n }}
                  </th>
                  <td mat-cell *matCellDef="let peer">
                    {{ formatConnTime(peer.conntime) }}
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
              </table>
            </div>

            <mat-paginator
              [pageSize]="10"
              [pageSizeOptions]="[10, 20, 50]"
              [showFirstLastButtons]="true"
            ></mat-paginator>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .page-layout {
        min-height: 100%;
      }

      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        padding: 16px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;

        h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 300;
        }

        .back-button {
          color: white;
          margin-right: 8px;
        }
      }

      .header-left {
        display: flex;
        align-items: center;
      }

      .header-right {
        display: flex;
        align-items: center;
        gap: 8px;

        .peer-count {
          color: rgba(255, 255, 255, 0.8);
          font-size: 14px;
        }

        button {
          color: white;
        }

        .spinning {
          animation: spin 1s linear infinite;
        }
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .content {
        padding: 24px;
      }

      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px;

        p {
          margin-top: 16px;
          color: rgba(0, 0, 0, 0.6);
        }
      }

      .error-message {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 16px;
        background: rgba(244, 67, 54, 0.1);
        border-radius: 4px;
        color: #f44336;
        margin-bottom: 16px;

        mat-icon {
          flex-shrink: 0;
        }
      }

      .peers-card {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        overflow: hidden;
      }

      .peers-table-container {
        overflow-x: auto;
        background: #ffffff;
      }

      .peers-table {
        width: 100%;

        th.mat-header-cell {
          font-weight: 600;
          font-size: 12px;
          text-transform: uppercase;
          color: rgb(0, 35, 65);
          background: #f5f7fa;
          border-bottom: 1px solid #d0d0e0;
          padding: 12px 16px;
        }

        td.mat-cell {
          font-size: 13px;
          color: rgb(0, 35, 65);
          border-bottom: 1px solid #e8e8e8;
          padding: 10px 16px;
        }

        tr.mat-row {
          transition: background 0.2s;

          &:hover {
            background: #f0f4ff;
          }
        }
      }

      .peer-address {
        display: flex;
        align-items: center;
        gap: 8px;

        .addr {
          font-family: monospace;
          font-size: 12px;
        }

        .network-badge {
          display: inline-block;
          font-size: 10px;
          padding: 3px 8px;
          border-radius: 10px;
          text-transform: uppercase;
          font-weight: 500;

          &.ipv4 {
            background: #e3f2fd;
            color: #1976d2;
          }

          &.ipv6 {
            background: #f3e5f5;
            color: #7b1fa2;
          }

          &.onion {
            background: #fff3e0;
            color: #e65100;
          }

          &.i2p {
            background: #e8f5e9;
            color: #388e3c;
          }

          &.cjdns {
            background: #fce4ec;
            color: #c2185b;
          }

          &.not_publicly_routable {
            background: #eceff1;
            color: #546e7a;
          }
        }
      }

      .chip {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 10px;
        background: #e6e6f2;
        font-size: 12px;
        font-weight: 500;
      }

      .versionOk {
        background: #cdffcd;
        color: #007f00;
      }

      .versionLow {
        background: #ffe0e0;
        color: #d30000;
      }

      .connection-type {
        display: inline-block;
        font-size: 12px;
        padding: 4px 12px;
        border-radius: 10px;
        font-weight: 500;
        background: #cdffcd;
        color: #007f00;

        &.inbound {
          background: #e6e6f2;
          color: rgb(0, 35, 65);
        }
      }

      mat-paginator {
        background: transparent;
        border-top: 1px solid #e8e8e8;

        ::ng-deep {
          .mat-mdc-paginator-container {
            color: #888888;
            min-height: 40px;
            padding: 0 8px;
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

      // Dark theme
      :host-context(.dark-theme) {
        .header {
          background: linear-gradient(135deg, #1a2f4a 0%, #234567 100%);
        }

        .peers-card {
          background: #424242;
        }

        .peers-table-container {
          background: #424242;
        }

        .peers-table {
          th.mat-header-cell {
            background: #383838;
            color: rgba(255, 255, 255, 0.87);
            border-bottom-color: #555;
          }

          td.mat-cell {
            color: rgba(255, 255, 255, 0.87);
            border-bottom-color: #555;
          }

          tr.mat-row:hover {
            background: rgba(255, 255, 255, 0.05);
          }
        }

        .loading-container p {
          color: rgba(255, 255, 255, 0.6);
        }

        mat-paginator {
          border-top-color: #555;
        }
      }

      @media (max-width: 768px) {
        .header {
          padding: 12px 16px;

          h1 {
            font-size: 20px;
          }
        }

        .content {
          padding: 16px;
        }

        .peer-address {
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
        }
      }
    `,
  ],
})
export class PeersComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly location = inject(Location);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly i18n = inject(I18nService);
  private readonly destroy$ = new Subject<void>();

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  peers = signal<PeerInfo[]>([]);
  isLoading = signal(false);
  error = signal<string | null>(null);

  dataSource = new MatTableDataSource<PeerInfo>();
  displayedColumns: string[] = [
    'addr',
    'subver',
    'connection_type',
    'synced_blocks',
    'bytesrecv',
    'bytessent',
    'conntime',
  ];

  private maxVersion = '0.0.1';

  ngOnInit(): void {
    this.loadPeers();
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack(): void {
    this.location.back();
  }

  async loadPeers(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const peerList = await this.blockchainRpc.getPeerInfo();
      this.peers.set(peerList);
      this.dataSource.data = peerList;
      this.calcMaxVersion();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load peers';
      this.error.set(errorMsg);
      console.error('Failed to load peers:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  async refresh(): Promise<void> {
    await this.loadPeers();
  }

  private calcMaxVersion(): void {
    const minVersion = '0.0.1';
    this.maxVersion = this.peers().reduce((maxVer, peer) => {
      try {
        // Extract version from subver like "/Satoshi:28.0.0/" or "/Bitcoin-PoCX:28.0.0/"
        const match = peer.subver.match(/:(\d+\.\d+\.\d+)/);
        if (match) {
          const peerVersion = match[1];
          if (this.compareVersions(peerVersion, maxVer) > 0) {
            return peerVersion;
          }
        }
      } catch {
        // Ignore parse errors
      }
      return maxVer;
    }, minVersion);
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  getVersionClass(peer: PeerInfo): string {
    try {
      const match = peer.subver.match(/:(\d+\.\d+\.\d+)/);
      if (match) {
        const peerVersion = match[1];
        if (this.compareVersions(peerVersion, this.maxVersion) < 0) {
          return 'chip versionLow';
        }
        return 'chip versionOk';
      }
    } catch {
      // Ignore parse errors
    }
    return 'chip';
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatConnTime(timestamp: number): string {
    const connDate = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - connDate.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays}d ${diffHours % 24}h`;
    } else if (diffHours > 0) {
      return `${diffHours}h`;
    } else {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return `${diffMinutes}m`;
    }
  }
}
