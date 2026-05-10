import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { CommandResult } from '../models/mining.models';

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

interface DnsFailure {
  network: string;
  error: string;
}

@Injectable({ providedIn: 'root' })
export class PoolsService {
  readonly pools = signal<Record<string, PoolEntry[]>>({});
  readonly dnsFailed = signal<DnsFailure | null>(null, {
    equal: (a, b) => {
      if (a === b) return true;
      if (a === null || b === null) return false;
      return a.network === b.network && a.error === b.error;
    },
  });

  private unlistenUpdated?: UnlistenFn;
  private unlistenFailed?: UnlistenFn;
  private initPromise?: Promise<void>;

  async init(): Promise<void> {
    return (this.initPromise ??= this.doInit());
  }

  private async doInit(): Promise<void> {
    const [unlistenUpdated, unlistenFailed] = await Promise.all([
      listen<{ network: string; pools: PoolEntry[] }>('pools:updated', (e) => {
        this.pools.update((cur) => ({ ...cur, [e.payload.network]: e.payload.pools }));
        this.dnsFailed.set(null);
      }),
      listen<DnsFailure>('pools:dns-failed', (e) => {
        this.dnsFailed.set(e.payload);
      }),
    ]);
    this.unlistenUpdated = unlistenUpdated;
    this.unlistenFailed = unlistenFailed;
  }

  async list(network: string): Promise<PoolEntry[]> {
    await this.init();
    const result = await invoke<CommandResult<PoolEntry[]>>('list_pools', { network });
    if (!result.success) {
      this.dnsFailed.set({ network, error: result.error ?? 'unknown error' });
      return this.pools()[network] ?? [];
    }
    const pools = result.data ?? [];
    this.pools.update((cur) => ({ ...cur, [network]: pools }));
    return pools;
  }

  async refresh(network: string): Promise<PoolEntry[]> {
    const result = await invoke<CommandResult<PoolEntry[]>>('refresh_pools', { network });
    if (!result.success) {
      this.dnsFailed.set({ network, error: result.error ?? 'unknown error' });
      return this.pools()[network] ?? [];
    }
    const pools = result.data ?? [];
    this.pools.update((cur) => ({ ...cur, [network]: pools }));
    return pools;
  }
}
