# Mining Dashboard Performance Issue

## Problem

The mining dashboard develops a 3-4s navigation delay that worsens progressively over days of continuous mining. The root cause is unbounded deadline accumulation in the frontend.

## Root Cause Analysis

### Dual-State Architecture

Deadlines flow from `pocx_miner` (Rust crate) through two independent paths:

```
pocx_miner finds deadline
       |
       v
callback.rs:on_deadline_accepted()
       |
       |--- add_deadline(state)             --> Backend Vec (capped 720/chain)
       |                                          |
       |                                          v
       |                                    get_mining_state IPC --> _state signal (bounded, unused for display)
       |
       |--- emit("miner:deadline-accepted") --> Frontend listener
                                                     |
                                                     v
                                                _minerState.recentDeadlines (UNBOUNDED, used by dashboard)
```

- **Backend** (`state.rs:495-511`): Inserts deadline, enforces 720-per-chain cap. Correct.
- **Frontend** (`mining.service.ts:2099-2104`): Receives event, filters by chain+height for dedup, prepends new entry. **No cap applied.**

The comment on line 2103 says "720-per-chain trimming handled by backend (state.rs)" but that only trims the backend's copy. The frontend grows forever.

### Growth Rate

With 2 chains at ~2-minute blocks:

| Duration | Frontend Deadlines | Impact |
|----------|--------------------|--------|
| Day 1    | ~1,440             | Barely noticeable |
| Day 7    | ~10,080            | Filter becomes sluggish |
| Day 14   | ~20,160            | Noticeable lag |
| Day 30   | ~43,200            | 3-4s+ delays |

### What Gets Slower

Every deadline event triggers an O(n) filter over the entire array (line 2100-2102).
On every scan-finished (line 2062), the entire array is:
1. Shallow-copied into `_capacityDeadlines`
2. Sorted O(n log n) in `generateEffectiveCapacityHistory()`
3. Reduced over all entries in `updateCapacityCache()`

### Secondary: Activity Logs

`addActivityLog` (line 1350-1354) does an O(n) filter on every log entry to remove items older than 24h. During active mining with frequent `miner:log` events, this adds up. The 24h cutoff bounds it eventually, but it's still wasteful. A `while` loop popping from the tail (oldest entries are at the end, array is chronological) would be O(1) amortized.

### Why the Backend Copy Goes Unused

The backend's bounded `recentDeadlines` (in `_state`) is only read once per app session during `initializeMining()` (line 443-448), guarded by `_minerInitialized`. This sync only matters on webview reload while the miner is already running (Rust backend survives webview restarts). For both normal start paths (auto-start and dashboard manual start), the miner hasn't produced any deadlines yet, so the sync is a no-op.

## Fix Options

### Option A: Quick Fix - Frontend Cap

Apply the same 720-per-chain limit on the frontend after each event insert, matching the backend.

In `mining.service.ts` around line 2104, after building `updatedDeadlines`, trim per chain:

```typescript
// Enforce per-chain limit (match backend's 720/chain cap)
const MAX_PER_CHAIN = 720;
const chainCounts: Record<string, number> = {};
const trimmed = updatedDeadlines.filter(dl => {
  chainCounts[dl.chainName] = (chainCounts[dl.chainName] || 0) + 1;
  return chainCounts[dl.chainName] <= MAX_PER_CHAIN;
});
```

Pros:
- Minimal change, quick to implement
- Frontend stays reactive (instant deadline display)

Cons:
- Still duplicates backend logic (dedup, cap)
- Two copies of the same data in memory

### Option B: Single Source of Truth (Recommended)

Remove frontend deadline accumulation. Read from the backend on `scan-finished`.

Changes:
1. **`miner:deadline-accepted` listener** - Only update `currentBlock.bestDeadline` for the live display. Don't accumulate into `recentDeadlines`.

2. **`miner:scan-status` (finished) listener** - Call `get_recent_deadlines` (command at `commands.rs:857`, already has a `limit` param) and set that as the deadline list. One IPC call per round (~2 min).

3. **Remove `_minerState.recentDeadlines`** - Deadlines live only in the backend. Frontend snapshots on scan-finished.

4. **`initializeMining()` recovery** - Same approach: call `get_recent_deadlines` to seed on init. Works naturally.

Pros:
- Single source of truth (backend)
- No frontend cap/dedup logic needed
- No O(n) filter per event
- Recovery sync works the same way
- One small bounded IPC call every ~2 minutes

Cons:
- New deadlines appear in the table after round finishes (seconds delay), not instantly
- The live "best deadline this round" still updates instantly from the event (this is what users watch)

### Activity Log Fix (Both Options)

Replace the O(n) filter in `addActivityLog` with tail-popping:

```typescript
this._activityLogs.update(logs => {
  const updated = [newEntry, ...logs];
  // Pop stale entries from tail (oldest) - O(1) amortized since array is chronological
  const cutoff = now - MiningService.WARN_ERROR_LOG_AGE_MS;
  while (updated.length > 0 && updated[updated.length - 1].timestamp < cutoff) {
    updated.pop();
  }
  return updated;
});
```

## Key Files

| File | Lines | What |
|------|-------|------|
| `mining/services/mining.service.ts` | 2099-2104 | Frontend deadline accumulation (no cap) |
| `mining/services/mining.service.ts` | 2062 | Full array copy on scan-finished |
| `mining/services/mining.service.ts` | 1350-1354 | Activity log O(n) filter |
| `mining/services/mining.service.ts` | 443-448 | One-time backend-to-frontend sync |
| `mining/models/mining.models.ts` | 630-681 | Capacity chart generation (sorts full array) |
| `src-tauri/src/mining/state.rs` | 457-518 | Backend add_deadline with 720/chain cap |
| `src-tauri/src/mining/commands.rs` | 857-864 | get_recent_deadlines with limit param |
