import { AccountId } from '../../interfaces/account'
import { Message } from '../../interfaces/userRequest'

export interface SignedMessage extends Message {
  dapp: { name: string; icon: string } | null
  timestamp: number
}

export interface InternalSignedMessages {
  [key: AccountId]: SignedMessage[]
}

/**
 * Persistent index of where the user has sent funds. Serves two purposes:
 * 1. per-account "have I sent to this address before" (fast path for `hasAccountOpsSentTo`), and
 * 2. "what address did this domain resolve to the last time I sent to it" (ENS/Namoshi
 * changed-address protection). (from any account)
 */
export interface SentToHistory {
  domains: { [domain: string]: { address: string; sentAt: number } }
  recipients: { [accountId: string]: { [toAddress: string]: number } }
}
