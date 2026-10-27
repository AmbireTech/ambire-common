import { RPCProvider } from '../interfaces/provider'
import wait from './wait'

const BLOCK_NUMBER_POLL_MIN_DELAY_MS = 250
const BLOCK_NUMBER_POLL_MAX_DELAY_MS = 2000

const isAtBlockNumber = async (provider: RPCProvider, blockNumber: number) => {
  try {
    return (await provider.getBlockNumber()) >= blockNumber
  } catch (error) {
    // A load balanced RPC can fail on one node and answer on the next, so it is asked again
    console.error(`Failed to get the block number while waiting for block ${blockNumber}`, error)
    return false
  }
}

/**
 * Waits until the RPC is at the given block or a later one, so the reads that follow include it.
 * Resolves after `timeoutMs` even when the RPC is still behind, so the caller always continues.
 */
export async function waitForBlockNumber(
  provider: RPCProvider,
  blockNumber: number,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs
  let delay = BLOCK_NUMBER_POLL_MIN_DELAY_MS

  while (!(await isAtBlockNumber(provider, blockNumber)) && Date.now() + delay <= deadline) {
    await wait(delay)
    delay = Math.min(delay * 2, BLOCK_NUMBER_POLL_MAX_DELAY_MS)
  }
}
