import { Injectable, computed, inject, signal } from '@angular/core';
import { BtcxWalletService, BtcxOverallHealth, BtcxServerHealth } from './btcx-wallet.service';
import { NodeService } from '../../node/services/node.service';

/** How often the passive health snapshots refresh while no sync events flow. */
const SNAPSHOT_REFRESH_MS = 10_000;

/**
 * ElectrumStatusService — the toolbar's view of remote-mode connectivity.
 *
 * With an OPEN wallet runtime, aggregate health rides the
 * `btcx-wallet:sync` event. Without one (fresh install, wallet-select,
 * locked wallet) there are no sync events, so the aggregate falls back to
 * the passive per-server health cells — kept fresh by a light periodic
 * refresh (`btcx_electrum_health` is a cheap in-process read; the cells are
 * fed by real traffic like the chain-info fetches).
 */
@Injectable({ providedIn: 'root' })
export class ElectrumStatusService {
  private readonly btcxWallet = inject(BtcxWalletService);
  private readonly nodeService = inject(NodeService);

  private readonly _servers = signal<BtcxServerHealth[]>([]);

  /** Per-server snapshots from the last refreshServers() call. */
  readonly servers = this._servers.asReadonly();

  constructor() {
    // Keep the fallback snapshots fresh while the wallet runtime is closed
    // (sync events take over once one is open). Only ticks in remote mode.
    setInterval(() => {
      if (!this.nodeService.isRemote()) return;
      if (this.btcxWallet.lastSync() !== null) return;
      void this.refreshServers();
    }, SNAPSHOT_REFRESH_MS);
  }

  /**
   * Aggregate connectivity: `connecting` (home untested), `healthy`,
   * `degraded` (home down, a failover healthy), `down`. Prefers the live
   * sync event; falls back to the per-server snapshots when no wallet
   * runtime is emitting.
   */
  readonly overall = computed<BtcxOverallHealth>(() => {
    const sync = this.btcxWallet.lastSync();
    if (sync) return sync.overall;

    const configured = this.btcxWallet.electrumServers();
    if (configured.length === 0) return 'down';
    const byUrl = new Map(this._servers().map(s => [s.url, s.state]));
    const homeState = byUrl.get(configured[0]) ?? 'untested';
    if (homeState === 'healthy') return 'healthy';
    if (homeState === 'down') {
      return configured.slice(1).some(url => byUrl.get(url) === 'healthy') ? 'degraded' : 'down';
    }
    // Home untested — nothing has talked to it yet this run.
    return 'connecting';
  });

  /** Height as of the last sync event (wallet checkpoint tip). */
  readonly height = computed(() => this.btcxWallet.lastSync()?.height ?? null);

  /** Seconds since the last completed sync pass. */
  readonly syncAgeSecs = computed(() => this.btcxWallet.lastSync()?.syncAgeSecs ?? null);

  /** The configured primary (home) server of the active network. */
  readonly primaryServer = computed(() => this.btcxWallet.electrumServers()[0] ?? null);

  /** Refresh the per-server snapshots (popover open / periodic fallback). */
  async refreshServers(): Promise<BtcxServerHealth[]> {
    try {
      const servers = await this.btcxWallet.electrumHealth();
      this._servers.set(servers);
      return servers;
    } catch (err) {
      console.error('Failed to fetch Electrum health:', err);
      return [];
    }
  }
}
