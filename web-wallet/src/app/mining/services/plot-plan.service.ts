import { Injectable } from '@angular/core';
import { DriveInfo, DriveConfig, PlotPlan, PlotPlanItem, PlotPlanStats } from '../models';

const BATCH_SIZE = 1024; // 1024 warps = 1 TiB

interface PlotConfig {
  parallelDrives: number;
}

interface DriveState {
  path: string;
  completeSizeGib: number;
  incompleteSizeGib: number;
  incompleteFiles: number;
  allocatedGib: number;
}

@Injectable({ providedIn: 'root' })
export class PlotPlanService {
  /**
   * Generate a plot plan from drive info and allocations
   */
  generatePlan(drives: DriveInfo[], driveConfigs: DriveConfig[], config: PlotConfig): PlotPlan {
    const plan: PlotPlanItem[] = [];
    const finishedDrives: string[] = [];
    let batchId = 0;

    // Build drive state from DriveInfo + DriveConfig
    const driveStates: DriveState[] = drives.map(drive => {
      const cfg = driveConfigs.find(c => c.path === drive.path);
      return {
        path: drive.path,
        completeSizeGib: drive.completeSizeGib,
        incompleteSizeGib: drive.incompleteSizeGib,
        incompleteFiles: drive.incompleteFiles,
        allocatedGib: cfg?.allocatedGib ?? 0,
      };
    });

    // Step 1: Identify finished drives (no work to do)
    for (const drive of driveStates) {
      const toPlot = drive.allocatedGib - drive.completeSizeGib;
      if (toPlot <= 0 && drive.incompleteFiles === 0) {
        finishedDrives.push(drive.path);
      }
    }

    // Step 2: Calculate total tasks per drive (for tracking completion)
    interface DriveTaskCount {
      resumeTasks: number;
      plotBatches: number;
      hasRemainder: boolean;
      remainderWarps: number;
      totalTasks: number;
    }

    const driveTaskCounts = new Map<string, DriveTaskCount>();

    for (const drive of driveStates) {
      const resumeTasks = drive.incompleteFiles;
      const toPlot = drive.allocatedGib - drive.completeSizeGib;
      const newPlots = Math.max(0, toPlot - drive.incompleteSizeGib);
      const plotBatches = Math.floor(newPlots / BATCH_SIZE);
      const remainderWarps = Math.round(newPlots % BATCH_SIZE);
      const hasRemainder = remainderWarps > 0;
      const totalTasks = resumeTasks + plotBatches + (hasRemainder ? 1 : 0);

      if (totalTasks > 0) {
        driveTaskCounts.set(drive.path, {
          resumeTasks,
          plotBatches,
          hasRemainder,
          remainderWarps,
          totalTasks,
        });
      }
    }

    // Track completed tasks per drive
    const driveCompletedTasks = new Map<string, number>();
    for (const path of driveTaskCounts.keys()) {
      driveCompletedTasks.set(path, 0);
    }

    // Helper: check if drive just completed and add ADD_MINER if so
    const checkAndAddMiner = (path: string) => {
      const counts = driveTaskCounts.get(path);
      const completed = driveCompletedTasks.get(path) || 0;
      if (counts && completed >= counts.totalTasks) {
        plan.push({ type: 'add_to_miner' });
      }
    };

    // Helper: increment completed count for a drive
    const markTaskComplete = (path: string) => {
      driveCompletedTasks.set(path, (driveCompletedTasks.get(path) || 0) + 1);
    };

    // Step 3: Generate resume tasks (highest priority, always sequential)
    for (const drive of driveStates) {
      if (drive.incompleteFiles > 0) {
        const sizePerFile = drive.incompleteSizeGib / drive.incompleteFiles;
        for (let i = 0; i < drive.incompleteFiles; i++) {
          plan.push({
            type: 'resume',
            path: drive.path,
            fileIndex: i,
            sizeGib: Math.round(sizePerFile),
          });
          markTaskComplete(drive.path);
          checkAndAddMiner(drive.path);
        }
      }
    }

    // Step 4: Calculate new plot work per drive
    interface DriveWork {
      path: string;
      fullBatches: number;
      remainderWarps: number;
      totalWork: number;
    }

    const driveWork: DriveWork[] = [];
    for (const drive of driveStates) {
      const toPlot = drive.allocatedGib - drive.completeSizeGib;
      const newPlots = Math.max(0, toPlot - drive.incompleteSizeGib);

      if (newPlots > 0) {
        const fullBatches = Math.floor(newPlots / BATCH_SIZE);
        const remainderWarps = Math.round(newPlots % BATCH_SIZE);
        driveWork.push({
          path: drive.path,
          fullBatches,
          remainderWarps,
          totalWork: newPlots,
        });
      }
    }

    // Step 5: Create unified work items (batches + remainders)
    interface WorkItem {
      path: string;
      warps: number;
      isRemainder: boolean;
      driveRemainingTasks: number;
    }

    const driveWorkItems = new Map<string, WorkItem[]>();
    for (const work of driveWork) {
      const items: WorkItem[] = [];
      const totalItems = work.fullBatches + (work.remainderWarps > 0 ? 1 : 0);

      for (let i = 0; i < work.fullBatches; i++) {
        items.push({
          path: work.path,
          warps: BATCH_SIZE,
          isRemainder: false,
          driveRemainingTasks: totalItems - i,
        });
      }

      if (work.remainderWarps > 0) {
        items.push({
          path: work.path,
          warps: work.remainderWarps,
          isRemainder: true,
          driveRemainingTasks: 1,
        });
      }

      driveWorkItems.set(work.path, items);
    }

    // Track current index per drive
    const driveIndex = new Map<string, number>();
    for (const path of driveWorkItems.keys()) {
      driveIndex.set(path, 0);
    }

    const getNextItem = (path: string): WorkItem | null => {
      const items = driveWorkItems.get(path);
      const idx = driveIndex.get(path) || 0;
      if (!items || idx >= items.length) return null;
      return items[idx];
    };

    const consumeItem = (path: string): void => {
      driveIndex.set(path, (driveIndex.get(path) || 0) + 1);
    };

    const getRemainingTasks = (path: string): number => {
      const items = driveWorkItems.get(path);
      const idx = driveIndex.get(path) || 0;
      if (!items) return 0;
      return items.length - idx;
    };

    // Schedule work items prioritizing drives with fewer remaining tasks
    const activeDrives = [...driveWorkItems.keys()];

    while (activeDrives.some(p => getNextItem(p) !== null)) {
      activeDrives.sort((a, b) => getRemainingTasks(a) - getRemainingTasks(b));

      const candidates: WorkItem[] = [];
      for (const path of activeDrives) {
        const item = getNextItem(path);
        if (item) {
          candidates.push(item);
        }
      }

      if (candidates.length === 0) break;

      // PRIORITY: Drives with only 1 task remaining go first
      const almostDone = candidates.filter(c => getRemainingTasks(c.path) === 1);
      const stillWorking = candidates.filter(c => getRemainingTasks(c.path) > 1);

      const group: WorkItem[] = [];
      const usedPaths = new Set<string>();

      // First: schedule almost-done drives (group by size for parallelization)
      if (almostDone.length > 0) {
        const bySize = new Map<number, WorkItem[]>();
        for (const item of almostDone) {
          const list = bySize.get(item.warps) || [];
          list.push(item);
          bySize.set(item.warps, list);
        }

        const sortedSizes = [...bySize.entries()].sort((a, b) => b[1].length - a[1].length);
        const [, items] = sortedSizes[0];

        for (const item of items) {
          if (group.length >= config.parallelDrives) break;
          group.push(item);
          usedPaths.add(item.path);
          consumeItem(item.path);
        }
      }

      // If group not full, try to add from stillWorking
      if (group.length < config.parallelDrives && stillWorking.length > 0) {
        const targetSize = group.length > 0 ? group[0].warps : null;

        let available = targetSize
          ? stillWorking.filter(c => c.warps === targetSize && !usedPaths.has(c.path))
          : stillWorking.filter(c => !usedPaths.has(c.path));

        if (available.length === 0 && group.length === 0) {
          const bySize = new Map<number, WorkItem[]>();
          for (const item of stillWorking) {
            const list = bySize.get(item.warps) || [];
            list.push(item);
            bySize.set(item.warps, list);
          }

          const sortedSizes = [...bySize.entries()].sort((a, b) => {
            if (b[1].length !== a[1].length) return b[1].length - a[1].length;
            const aMin = Math.min(...a[1].map(i => getRemainingTasks(i.path)));
            const bMin = Math.min(...b[1].map(i => getRemainingTasks(i.path)));
            return aMin - bMin;
          });

          available = sortedSizes[0][1];
        }

        available.sort((a, b) => getRemainingTasks(a.path) - getRemainingTasks(b.path));

        for (const item of available) {
          if (group.length >= config.parallelDrives) break;
          if (usedPaths.has(item.path)) continue;
          group.push(item);
          usedPaths.add(item.path);
          consumeItem(item.path);
        }
      }

      // Add group to plan
      for (const item of group) {
        plan.push({
          type: 'plot',
          path: item.path,
          warps: item.warps,
          batchId,
        });
        markTaskComplete(item.path);
      }
      batchId++;

      // Check for completed drives
      for (const item of group) {
        checkAndAddMiner(item.path);
      }
    }

    // Compress consecutive add_to_miner items into single one
    // (multiple drives finishing in same batch only need one miner restart)
    const compressedPlan: PlotPlanItem[] = [];
    for (const item of plan) {
      const lastItem = compressedPlan[compressedPlan.length - 1];
      if (item.type === 'add_to_miner' && lastItem?.type === 'add_to_miner') {
        continue; // Skip consecutive add_to_miner
      }
      compressedPlan.push(item);
    }

    // Return simplified plan (runtime-only, not persisted)
    return {
      items: compressedPlan,
      configHash: this.computeConfigHash(drives, driveConfigs, config),
      generatedAt: Date.now(),
    };
  }

  /**
   * Compute a hash of the configuration for change detection
   */
  computeConfigHash(drives: DriveInfo[], driveConfigs: DriveConfig[], config: PlotConfig): string {
    const data = {
      drives: drives.map(d => ({
        path: d.path,
        complete: d.completeSizeGib,
        incomplete: d.incompleteSizeGib,
        incompleteFiles: d.incompleteFiles,
      })),
      allocations: driveConfigs.map(c => ({
        path: c.path,
        allocated: c.allocatedGib,
      })),
      parallelDrives: config.parallelDrives,
    };
    // Simple hash: JSON stringify and sum char codes
    const json = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < json.length; i++) {
      hash = ((hash << 5) - hash + json.charCodeAt(i)) | 0;
    }
    return hash.toString(16);
  }

  /**
   * Validate if existing plan is still valid
   */
  validatePlan(plan: PlotPlan, currentHash: string): boolean {
    return plan.configHash === currentHash;
  }

  /**
   * Calculate stats for a plan
   * Counts batches (not individual items) for task progress
   *
   * @param plan The plot plan
   * @param currentIndex The current execution index (from PlotterState)
   */
  getPlanStats(plan: PlotPlan, currentIndex: number = 0): PlotPlanStats {
    // Count batches instead of individual items
    // Items with same batchId count as one batch
    let totalTasks = 0;
    let completedTasks = 0;
    const seenBatchIds = new Set<number>();
    const completedBatchIds = new Set<number>();

    let totalWarps = 0;
    let completedWarps = 0;

    for (let i = 0; i < plan.items.length; i++) {
      const item = plan.items[i];

      if (item.type === 'plot') {
        totalWarps += item.warps;
        if (i < currentIndex) {
          completedWarps += item.warps;
        }

        // Count unique batches
        if (!seenBatchIds.has(item.batchId)) {
          seenBatchIds.add(item.batchId);
          totalTasks++;
        }
        if (i < currentIndex && !completedBatchIds.has(item.batchId)) {
          completedBatchIds.add(item.batchId);
          completedTasks++;
        }
      } else if (item.type === 'resume') {
        totalWarps += item.sizeGib;
        if (i < currentIndex) {
          completedWarps += item.sizeGib;
        }
        // Resume items are individual tasks
        totalTasks++;
        if (i < currentIndex) {
          completedTasks++;
        }
      } else if (item.type === 'add_to_miner') {
        // add_to_miner items are individual tasks (but quick)
        totalTasks++;
        if (i < currentIndex) {
          completedTasks++;
        }
      }
    }

    const remainingTasks = totalTasks - completedTasks;
    const remainingWarps = totalWarps - completedWarps;
    const completedGib = completedWarps;
    const completedTib = completedGib / 1024;
    const remainingGib = remainingWarps;
    const remainingTib = remainingGib / 1024;

    return {
      totalTasks,
      completedTasks,
      remainingTasks,
      totalWarps,
      completedWarps,
      remainingWarps,
      completedGib,
      completedTib,
      remainingGib,
      remainingTib,
    };
  }

  /**
   * Format ETA based on remaining work and current speed
   */
  formatEta(remainingGib: number, speedMibS: number): string {
    if (speedMibS <= 0) return '--';

    const remainingMib = remainingGib * 1024;
    const seconds = remainingMib / speedMibS;

    if (seconds < 60) return '< 1m';
    if (seconds < 3600) return `~${Math.round(seconds / 60)}m`;
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.round((seconds % 3600) / 60);
      return `~${hours}h ${mins}m`;
    }
    const days = Math.floor(seconds / 86400);
    const hours = Math.round((seconds % 86400) / 3600);
    return `~${days}d ${hours}h`;
  }
}
