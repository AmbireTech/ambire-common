import { AccountOpStatus } from '../../libs/accountOp/types'

/** How often to check the Safe for the onchain approval of a smart account owner */
export const SAFE_OWNER_APPROVAL_CHECK_INTERVAL_MS = 3000

/** Time limit for one check of the Safe, so a stuck RPC can't hold up the next one */
export const SAFE_OWNER_APPROVAL_CHECK_TIMEOUT_MS = 15000

/** How long to wait for a sent approval of a smart account owner to be onchain */
export const SAFE_OWNER_APPROVAL_CONFIRMATION_TIMEOUT_MS = 3 * 60 * 1000

/** Statuses of a sent approval after which it will never be onchain */
export const FAILED_SAFE_OWNER_APPROVAL_STATUSES = [
  AccountOpStatus.Failure,
  AccountOpStatus.Rejected
]
