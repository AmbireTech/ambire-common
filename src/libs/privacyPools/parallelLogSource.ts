import type { EthereumProvider, TxLog } from '@kohaku-eth/provider'

/**
 * Blocks per `eth_getLogs` call.
 *
 * Not a tuning choice - the wallet's own RPC refuses anything wider with "eth_getLogs is limited
 * to 5000 block range", so the only way to cover a range faster is more calls at once, not fewer
 * wider ones.
 */
const LOG_WINDOW_BLOCKS = 5000n

/**
 * How many windows are in flight at once.
 *
 * Measured against `invictus.ambire.com`: one at a time answers 1.6 requests a second, five answer
 * about seven, and past that the endpoint queues rather than parallelizes - thirty-two in flight
 * buy a further third at the cost of a p95 four times worse. Five sits just past the knee and
 * leaves the endpoint, which every other part of the wallet shares, room to answer them.
 */
const LOG_WINDOW_CONCURRENCY = 5

/** Retries per window before the whole read gives up. */
const MAX_ATTEMPTS = 4

/** Doubles per attempt. Covers a rate limit or a dropped connection, not a refused query. */
const BASE_BACKOFF_MS = 500

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** The shape the SDK's data service asks a log source for. Not exported by the SDK. */
export type PrivacyPoolsLogsParams = {
  address: string
  fromBlock: bigint
  toBlock?: bigint
  maxQuerySize?: bigint
}

/**
 * Reads an address's logs over a block range, several windows at a time.
 *
 * The SDK's own reader walks the range one window after another, which is what makes a first sync
 * expensive: the entrypoint alone is close to eight hundred windows, and nothing about them depends
 * on each other. Running five at once turns ten minutes into under two without asking the RPC for
 * anything it does not already serve.
 *
 * Two things this must not get wrong. The logs come back in block order regardless of which window
 * finished first, because callers read the last event of a kind and mean the latest one - the ASP
 * root update is chosen that way. And a window that cannot be read after its retries fails the
 * whole read rather than returning what did arrive: a sync missing a `PoolRegistered` would look
 * like a pool that does not exist, which is worse than a sync that failed and says so.
 */
export const createParallelLogSource =
  ({ provider }: { provider: EthereumProvider }) =>
  async (params: PrivacyPoolsLogsParams): Promise<TxLog[]> => {
    const toBlock = params.toBlock ?? (await provider.getBlockNumber())
    const step = params.maxQuerySize ?? LOG_WINDOW_BLOCKS

    const windows: { from: bigint; to: bigint }[] = []
    for (let from = params.fromBlock; from <= toBlock; from += step) {
      const end = from + step - 1n
      windows.push({ from, to: end < toBlock ? end : toBlock })
    }

    const readWindow = async ({ from, to }: { from: bigint; to: bigint }): Promise<TxLog[]> => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await provider.getLogs({ address: params.address, fromBlock: from, toBlock: to })
        } catch (error) {
          if (attempt >= MAX_ATTEMPTS) throw error

          await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1))
        }
      }
    }

    // Written into the slot the window occupies rather than appended, so the result is in block
    // order whatever order the answers arrive in.
    const logsByWindow: TxLog[][] = new Array(windows.length)
    let nextWindow = 0

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = nextWindow
        nextWindow += 1
        if (index >= windows.length) return

        logsByWindow[index] = await readWindow(windows[index]!)
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(LOG_WINDOW_CONCURRENCY, windows.length) }, worker)
    )

    return logsByWindow.flat()
  }
