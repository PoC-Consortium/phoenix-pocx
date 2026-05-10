import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export type PoolSource = { kind: 'static' } | { kind: 'discovered'; authority: string };

export interface PoolEntry {
  host: string;
  port: number;
  url: string;
  name: string;
  priority: number;
  weight: number;
  source: PoolSource;
  extras: Record<string, string>;
}

interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface DnsFailure {
  network: string;
  error: string;
}

@Injectable({ providedIn: 'root' })
export class PoolsService {
  readonly pools = signal<Record<string, PoolEntry[]>>({});
  readonly dnsFailed = signal<DnsFailure | null>(null);

  private unlistenUpdated?: UnlistenFn;
  private unlistenFailed?: UnlistenFn;

  async init(): Promise<void> {
    if (this.unlistenUpdated) return;
    this.unlistenUpdated = await listen<{ network: string; pools: PoolEntry[] }>(
      'pools:updated',
      (e) => {
        this.pools.update((cur) => ({ ...cur, [e.payload.network]: e.payload.pools }));
        this.dnsFailed.set(null);
      },
    );
    this.unlistenFailed = await listen<DnsFailure>('pools:dns-failed', (e) => {
      this.dnsFailed.set(e.payload);
    });
  }

  async list(network: string): Promise<PoolEntry[]> {
    await this.init();
    const result = await invoke<CommandResult<PoolEntry[]>>('list_pools', { network });
    const pools = result.success && result.data ? result.data : [];
    this.pools.update((cur) => ({ ...cur, [network]: pools }));
    return pools;
  }

  async refresh(network: string): Promise<PoolEntry[]> {
    const result = await invoke<CommandResult<PoolEntry[]>>('refresh_pools', { network });
    const pools = result.success && result.data ? result.data : [];
    this.pools.update((cur) => ({ ...cur, [network]: pools }));
    return pools;
  }
}
