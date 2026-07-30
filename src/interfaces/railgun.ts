import { ControllerInterface } from './controller'

export type IRailgunController = ControllerInterface<
  InstanceType<typeof import('../controllers/railgun/railgun').RailgunController>
>

export type RailgunSyncStatus = 'idle' | 'unlock-required' | 'initializing' | 'syncing' | 'ready'

export type RailgunShieldedBalance = {
  tokenAddress: string
  amount: bigint
}

export type RailgunActivityType = 'shield' | 'unshield' | 'transfer'

/**
 * A Railgun operation started from this wallet. Railgun's own pool exposes no transaction
 * history (`notes()` returns unspent notes only, with no timestamp or txn id, and change notes
 * are indistinguishable from received ones), so activity is recorded locally as operations are
 * performed instead of being derived from chain state.
 */
export type RailgunActivityEntry = {
  id: string
  type: RailgunActivityType
  tokenAddress: string
  // Native shields/unshields move the wrapped base token in the pool - kept so the UI can
  // label the entry with the asset the user picked, not the wrapped one.
  isNative: boolean
  amount: bigint
  // Public 0x address for unshields, 0zk address for private transfers, null for shields
  recipient: string | null
  status: RailgunActivityStatus
  createdAt: number
  // Set when `status` is 'failed', to surface why without digging through logs
  error?: string
}

/**
 * 'pending' means "not observed as complete yet". Unshields/transfers resolve from their own
 * broadcast result; shields are broadcast by the regular sign & broadcast flow, which never
 * reports back here, so they resolve on the next sync that shows the balance growing.
 */
export type RailgunActivityStatus = 'pending' | 'success' | 'failed'
