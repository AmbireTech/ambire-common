import { Account } from '../../interfaces/account'
import { RPCProvider } from '../../interfaces/provider'
import { isSmartAccount } from '../../libs/account/account'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { getSafeApproveHashCall, isSafeHashApproved } from '../../libs/safe/safe'
import { generateUuid } from '../../utils/uuid'
import wait from '../../utils/wait'
import { withTimeout } from '../../utils/with-timeout'
import {
  FAILED_SAFE_OWNER_APPROVAL_STATUSES,
  SAFE_OWNER_APPROVAL_CHECK_INTERVAL_MS,
  SAFE_OWNER_APPROVAL_CHECK_TIMEOUT_MS,
  SAFE_OWNER_APPROVAL_CONFIRMATION_TIMEOUT_MS
} from './consts'
import { SafeOwnerApprovalResult } from './types'

/**
 * The owners of a Safe that are smart accounts imported in the wallet. They can't sign a Safe
 * transaction with a key, so each of them approves it onchain instead
 */
export const getSafeSmartAccountOwners = (safeOwners: string[], accounts: Account[]): string[] =>
  safeOwners.filter((owner) =>
    accounts.some(
      (account) => account.addr.toLowerCase() === owner.toLowerCase() && isSmartAccount(account)
    )
  )

/** The transaction of a smart account owner that approves a Safe transaction hash onchain */
export const getSafeOwnerApprovalAccountOp = ({
  ownerAddr,
  chainId,
  nonce,
  safeAddr,
  safeTxnHash
}: {
  ownerAddr: string
  chainId: bigint
  /** The nonce of the owner account, not of the Safe */
  nonce: bigint
  safeAddr: string
  safeTxnHash: string
}): AccountOp => ({
  id: generateUuid(),
  accountAddr: ownerAddr,
  chainId,
  signingKeyAddr: null,
  signingKeyType: null,
  gasLimit: null,
  gasFeePayment: null,
  nonce,
  signature: null,
  calls: [{ ...getSafeApproveHashCall(safeAddr, safeTxnHash), id: generateUuid() }]
})

/**
 * Waits until a sent approval of a Safe smart account owner is onchain. Asks the Safe itself,
 * as it's what checks the approval when it executes. Stops early when the approval
 * transaction failed or `shouldStop` says so, and gives up after `timeoutMs`
 */
export async function waitForSafeOwnerApproval({
  safeAddr,
  ownerAddr,
  safeTxnHash,
  provider,
  getSentApprovalStatus,
  shouldStop,
  onCheckError,
  checkIntervalMs = SAFE_OWNER_APPROVAL_CHECK_INTERVAL_MS,
  checkTimeoutMs = SAFE_OWNER_APPROVAL_CHECK_TIMEOUT_MS,
  timeoutMs = SAFE_OWNER_APPROVAL_CONFIRMATION_TIMEOUT_MS
}: {
  safeAddr: string
  ownerAddr: string
  safeTxnHash: string
  provider: RPCProvider
  /** The status of the sent approval transaction, e.g. from the activity */
  getSentApprovalStatus: () => AccountOpStatus | undefined
  shouldStop: () => boolean
  /** A failed check, e.g. the RPC is down for a moment. It's checked again after it */
  onCheckError: (error: Error) => void
  checkIntervalMs?: number
  checkTimeoutMs?: number
  timeoutMs?: number
}): Promise<SafeOwnerApprovalResult> {
  const startedAt = Date.now()
  while (!shouldStop() && Date.now() - startedAt < timeoutMs) {
    try {
      const isApproved = await withTimeout(
        () => isSafeHashApproved(safeAddr, ownerAddr, safeTxnHash, provider),
        {
          timeoutMs: checkTimeoutMs,
          message: `Checking the Safe owner approval timed out after ${checkTimeoutMs}ms`
        }
      )
      if (isApproved) return { isApproved: true, hasFailed: false }
    } catch (error: any) {
      onCheckError(error)
    }

    const sentApprovalStatus = getSentApprovalStatus()
    if (sentApprovalStatus && FAILED_SAFE_OWNER_APPROVAL_STATUSES.includes(sentApprovalStatus)) {
      return { isApproved: false, hasFailed: true }
    }

    await wait(checkIntervalMs)
  }

  return { isApproved: false, hasFailed: false }
}

/** What to tell the user when a sent approval couldn't be added as the owner's signature */
export const getSafeOwnerApprovalFailureMessage = ({
  isApproved,
  hasFailed
}: SafeOwnerApprovalResult): string => {
  if (hasFailed) return "The approval didn't go through. Please try again."
  // approved, but the Safe transaction changed in the meantime, e.g. its nonce
  if (isApproved) return 'The transaction changed after it was approved. Please approve it again.'

  return "The approval isn't confirmed yet. Check its status in your activity before approving again."
}
