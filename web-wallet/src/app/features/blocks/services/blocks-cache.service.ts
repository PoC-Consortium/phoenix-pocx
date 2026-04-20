import { Injectable, computed, inject, signal } from '@angular/core';
import { BlockchainRpcService } from '../../../bitcoin/services/rpc/blockchain-rpc.service';
import { PocxBlock } from '../models/block.model';

const MAX_BLOCKS = 720;

/**
 * Caches recent block bodies and the current canonical-chain ordering.
 *
 * Design notes:
 *  - Cache is keyed by **hash** (not height). Block bodies are immutable per hash,
 *    so a hit is always correct. Height can change block under a reorg, so we
 *    never key by height.
 *  - `canonicalHashes` is the ordered list of hashes from tip backwards that the
 *    UI renders. Updated by walking from the current tip via `previousblockhash`.
 *  - Load strategy: ask the node for the tip hash. Walk backwards using the
 *    previous-block-hash field of each block. When we encounter a hash we've
 *    already cached, we reuse it and skip the RPC. A reorg shows up naturally:
 *    the new tip's ancestors diverge from the old canonical chain at the fork
 *    point; beyond that we fetch fresh blocks, and the old forked-off blocks
 *    are pruned out of the cache.
 *  - Cap: the cache never grows beyond `MAX_BLOCKS` entries. Oldest-insertion
 *    entries are evicted first.
 */
@Injectable({ providedIn: 'root' })
export class BlocksCacheService {
  private readonly rpc = inject(BlockchainRpcService);

  private readonly blockByHash = new Map<string, PocxBlock>();
  private readonly _canonical = signal<string[]>([]);
  private readonly _loading = signal(false);

  readonly recentBlocks = computed<PocxBlock[]>(() =>
    this._canonical()
      .map(h => this.blockByHash.get(h))
      .filter((b): b is PocxBlock => b !== undefined)
  );
  readonly loading = this._loading.asReadonly();

  /**
   * Ensure the cache contains up to `count` blocks from the tip backwards.
   * Walks via previousblockhash; reuses cached blocks where possible.
   */
  async loadRecent(count: number): Promise<void> {
    if (this._loading()) return;
    this._loading.set(true);
    try {
      const effective = Math.max(1, Math.min(count, MAX_BLOCKS));
      const tipHeight = await this.rpc.getBlockCount();
      if (tipHeight <= 0) {
        this._canonical.set([]);
        return;
      }

      const tipHash = await this.rpc.getBlockHash(tipHeight);

      const chain: string[] = [];
      let cursor: string | null = tipHash;

      while (cursor && chain.length < effective) {
        chain.push(cursor);
        let block = this.blockByHash.get(cursor);
        if (!block) {
          block = (await this.rpc.getBlock(cursor, 1)) as unknown as PocxBlock;
          this.blockByHash.set(cursor, block);
        }
        cursor = block.previousblockhash ?? null;
      }

      this._canonical.set(chain);
      this.evictOverCap();
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Throw away the cache and reload fresh. Wire this to the manual refresh
   * button so users can always bypass the cache explicitly.
   */
  async forceReload(count: number): Promise<void> {
    this.blockByHash.clear();
    this._canonical.set([]);
    await this.loadRecent(count);
  }

  /**
   * Fetch a single block by hash or height. Cache lookup by hash; on a height
   * lookup we ask the node for the hash first (cheap) and then consult the
   * cache. On miss we fetch and store.
   */
  async getBlock(hashOrHeight: string): Promise<PocxBlock> {
    const asHash = this.blockByHash.get(hashOrHeight);
    if (asHash) return asHash;

    let block: PocxBlock;
    if (/^\d+$/.test(hashOrHeight)) {
      const height = parseInt(hashOrHeight, 10);
      const hash = await this.rpc.getBlockHash(height);
      const hit = this.blockByHash.get(hash);
      if (hit) return hit;
      block = (await this.rpc.getBlock(hash, 1)) as unknown as PocxBlock;
    } else {
      block = (await this.rpc.getBlock(hashOrHeight, 1)) as unknown as PocxBlock;
    }
    this.blockByHash.set(block.hash, block);
    this.evictOverCap();
    return block;
  }

  private evictOverCap(): void {
    // Map iteration order = insertion order. Keep blocks currently in the
    // canonical chain plus the newest non-canonical ones.
    const canonical = new Set(this._canonical());
    const totalCap = MAX_BLOCKS;

    // First, drop orphans (not in canonical) from oldest until we're within cap.
    if (this.blockByHash.size > totalCap) {
      for (const h of Array.from(this.blockByHash.keys())) {
        if (this.blockByHash.size <= totalCap) break;
        if (!canonical.has(h)) this.blockByHash.delete(h);
      }
    }
    // If still over cap (extraordinary), drop oldest canonical entries as a
    // last resort so we don't grow unbounded after repeated window expansions.
    while (this.blockByHash.size > totalCap) {
      const first = this.blockByHash.keys().next().value;
      if (first === undefined) break;
      this.blockByHash.delete(first);
    }
  }
}
