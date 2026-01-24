import { Injectable, inject, signal, OnDestroy, computed } from '@angular/core';
import { Subject, interval, takeUntil } from 'rxjs';
import { BlockchainRpcService, BlockchainInfo, Block, PeerInfo } from './rpc/blockchain-rpc.service';
import { CookieAuthService } from '../../core/auth/cookie-auth.service';
import { PocxNotificationService } from './pocx-notification.service';

/**
 * PoCX block extension with base_target for capacity calculation
 */
export interface PoCXBlock extends Block {
  base_target?: number;
}

/**
 * Sync phase enum for UI display
 */
export type SyncPhase = 'connecting' | 'header_sync' | 'block_sync' | 'synced';

/**
 * Sync state with phase and progress information
 */
export interface SyncState {
  phase: SyncPhase;
  percent: number;
  blocks: number;
  headers: number;
  targetHeight: number;
}

// PoCX constants for network capacity calculation
const BLOCK_TIME_SECONDS = 120; // 2 minutes
const GENESIS_BASE_TARGET = Math.pow(2, 42) / BLOCK_TIME_SECONDS;

/**
 * BlockchainStateService provides centralized, auto-refreshing blockchain state.
 *
 * This service polls the blockchain every 15 seconds and exposes signals
 * that components can subscribe to. This eliminates duplicate RPC calls
 * and ensures all components see consistent data.
 *
 * Usage:
 * ```typescript
 * blockchainState = inject(BlockchainStateService);
 * blockHeight = this.blockchainState.blockHeight; // Signal<number>
 * ```
 */
@Injectable({ providedIn: 'root' })
export class BlockchainStateService implements OnDestroy {
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly cookieAuth = inject(CookieAuthService);
  private readonly notificationService = inject(PocxNotificationService);
  private readonly destroy$ = new Subject<void>();

  // Polling configuration
  private readonly pollInterval = 15000; // 15 seconds
  private isPolling = false;

  // State tracking for notifications
  private wasConnected = false;
  private wasSynced = false;
  private isInitialized = false;

  // Blockchain info signals
  readonly blockHeight = signal(0);
  readonly bestBlockHash = signal('');
  readonly chain = signal('');
  readonly headers = signal(0);
  readonly verificationProgress = signal(0);
  readonly initialBlockDownload = signal(false);
  readonly difficulty = signal(0);

  // Peer-derived signals
  readonly peerTargetHeight = signal(0);
  readonly peerCount = signal(0);

  // Best block signals (from getBlock)
  readonly lastBlockTime = signal(0);
  readonly baseTarget = signal<number | null>(null);

  // Computed sync state with phase detection
  readonly syncState = computed<SyncState>(() => this.calculateSyncState());

  // Loading state
  readonly isLoading = signal(false);
  readonly lastUpdated = signal<Date | null>(null);
  readonly lastError = signal<string | null>(null);

  /**
   * Start polling for blockchain updates.
   * Called once on app initialization.
   */
  startPolling(): void {
    if (this.isPolling) return;
    this.isPolling = true;

    // Initial load
    this.refresh();

    // Set up polling interval
    interval(this.pollInterval)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.refresh());
  }

  /**
   * Stop polling for blockchain updates.
   */
  stopPolling(): void {
    this.isPolling = false;
    this.destroy$.next();
  }

  /**
   * Manually trigger a refresh of blockchain state.
   * Silently skips if RPC credentials are not yet available.
   */
  async refresh(): Promise<void> {
    // Skip if not authenticated (credentials not loaded yet)
    if (!this.cookieAuth.isAuthenticated) {
      return;
    }

    this.isLoading.set(true);
    this.lastError.set(null);

    try {
      // Get blockchain info and peer info in parallel
      const [info, peers] = await Promise.all([
        this.blockchainRpc.getBlockchainInfo(),
        this.blockchainRpc.getPeerInfo().catch(() => [] as PeerInfo[]),
      ]);

      this.updateFromBlockchainInfo(info);
      this.updateFromPeerInfo(peers);

      // Get best block for additional info (time, base_target)
      if (info.bestblockhash) {
        const block = (await this.blockchainRpc.getBlock(info.bestblockhash, 1)) as PoCXBlock;
        this.updateFromBlock(block);
      }

      this.lastUpdated.set(new Date());

      // Handle connection state change notifications
      if (this.isInitialized && !this.wasConnected) {
        this.notificationService.notifyNodeConnected();
      }
      this.wasConnected = true;

      // Handle sync completion notification
      const isSyncedNow = this.isSynced();
      if (this.isInitialized && !this.wasSynced && isSyncedNow) {
        this.notificationService.notifySyncComplete();
      }
      this.wasSynced = isSyncedNow;

      this.isInitialized = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch blockchain info';
      this.lastError.set(message);

      // Handle disconnection notification
      if (this.isInitialized && this.wasConnected) {
        this.notificationService.notifyNodeDisconnected();
      }
      this.wasConnected = false;
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Update signals from BlockchainInfo response
   */
  private updateFromBlockchainInfo(info: BlockchainInfo): void {
    this.blockHeight.set(info.blocks);
    this.bestBlockHash.set(info.bestblockhash);
    this.chain.set(info.chain);
    this.headers.set(info.headers);
    this.verificationProgress.set(info.verificationprogress);
    this.initialBlockDownload.set(info.initialblockdownload);
    this.difficulty.set(info.difficulty);
  }

  /**
   * Update signals from Block response
   */
  private updateFromBlock(block: PoCXBlock): void {
    this.lastBlockTime.set(block.time);
    this.baseTarget.set(block.base_target ?? null);
  }

  /**
   * Update signals from PeerInfo response
   */
  private updateFromPeerInfo(peers: PeerInfo[]): void {
    this.peerCount.set(peers.length);

    // Get target height from the highest peer starting height
    if (peers.length > 0) {
      const maxHeight = Math.max(...peers.map(p => p.startingheight || 0));
      this.peerTargetHeight.set(maxHeight);
    }
  }

  /**
   * Calculate sync state with phase detection
   */
  private calculateSyncState(): SyncState {
    const blocks = this.blockHeight();
    const headers = this.headers();
    const ibd = this.initialBlockDownload();
    const targetHeight = this.peerTargetHeight();
    const verifyProgress = this.verificationProgress();

    // Fully synced
    if (!ibd && verifyProgress > 0.9999) {
      return {
        phase: 'synced',
        percent: 100,
        blocks,
        headers,
        targetHeight,
      };
    }

    // No peers yet - connecting
    if (targetHeight === 0) {
      return {
        phase: 'connecting',
        percent: 0,
        blocks,
        headers,
        targetHeight: 0,
      };
    }

    // Phase 1: Header sync (headers catching up to peer-reported height)
    // Use 99.5% threshold to account for new blocks during sync
    if (headers < targetHeight * 0.995) {
      const headerPercent = (headers / targetHeight) * 100;
      return {
        phase: 'header_sync',
        percent: Math.min(Math.max(headerPercent, 0), 99.9),
        blocks,
        headers,
        targetHeight,
      };
    }

    // Phase 2: Block sync (blocks catching up to headers)
    const blockPercent = headers > 0 ? (blocks / headers) * 100 : 0;
    return {
      phase: 'block_sync',
      percent: Math.min(Math.max(blockPercent, 0), 99.9),
      blocks,
      headers,
      targetHeight,
    };
  }

  /**
   * Get sync progress as percentage (0-100)
   * @deprecated Use syncState signal instead
   */
  getSyncProgress(): number {
    return Math.round(this.verificationProgress() * 100);
  }

  /**
   * Check if blockchain is fully synced
   */
  isSynced(): boolean {
    return this.syncState().phase === 'synced';
  }

  /**
   * Calculate network capacity from base_target (PoCX specific)
   * Returns capacity in bytes
   */
  getNetworkCapacityBytes(): number | null {
    const target = this.baseTarget();
    if (target === null || target === 0) return null;

    const capacityRatio = GENESIS_BASE_TARGET / target;
    return capacityRatio * Math.pow(2, 40);
  }

  /**
   * Format network capacity as human-readable string
   */
  getNetworkCapacityFormatted(): string {
    const bytes = this.getNetworkCapacityBytes();
    if (bytes === null) return 'N/A';

    const TiB = Math.pow(2, 40);
    const PiB = Math.pow(2, 50);
    const EiB = Math.pow(2, 60);

    if (bytes >= EiB) {
      return (bytes / EiB).toFixed(3) + ' EiB';
    } else if (bytes >= PiB) {
      return (bytes / PiB).toFixed(3) + ' PiB';
    } else {
      return (bytes / TiB).toFixed(3) + ' TiB';
    }
  }

  /**
   * Format last block time as localized string
   */
  getLastBlockTimeFormatted(): string {
    const time = this.lastBlockTime();
    if (!time) return 'N/A';
    return new Date(time * 1000).toLocaleString();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
