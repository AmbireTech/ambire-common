import { processBalances, processCollections } from '../portfolio/balanceProcessing'

/**
 * Every function that may run off the main thread. Adding an entry here is the
 * only change needed to make a function offloadable
 *
 * See README.md in this folder for what a task is allowed to do.
 */
export const OFFLOAD_TASKS = {
  processBalances,
  processCollections
} as const

export type OffloadTask = keyof typeof OFFLOAD_TASKS

export type OffloadInput<K extends OffloadTask> = Parameters<(typeof OFFLOAD_TASKS)[K]>[0]

export type OffloadOutput<K extends OffloadTask> = ReturnType<(typeof OFFLOAD_TASKS)[K]>
