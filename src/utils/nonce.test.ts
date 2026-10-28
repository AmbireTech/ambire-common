import { describe, expect, it } from '@jest/globals'

import { CONFIRMED_NONCE_SETTLE_MS } from '../consts/activity'
import { Account } from '../interfaces/account'
import { AccountOp } from '../libs/accountOp/accountOp'
import { SubmittedAccountOp } from '../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../libs/accountOp/types'
import { BROADCAST_OPTIONS } from '../libs/broadcast/broadcast'
import {
  getNextNonce,
  getNonceKeys,
  getPendingNonceReservations,
  getReceiptBlockNumberByChainId,
  getSubmittedAccountOpNonces,
  NonceKey,
  ReservedNonce
} from './nonce'

const ACCOUNT = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
const PAYER = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'

const makeAccountOp = (
  broadcastOption: string,
  overrides: Partial<AccountOp> = {}
): Pick<AccountOp, 'accountAddr' | 'nonce' | 'safeTx' | 'gasFeePayment' | 'meta'> => ({
  accountAddr: ACCOUNT,
  nonce: 3n,
  gasFeePayment: {
    paidBy: PAYER,
    paidByKeyType: 'internal',
    broadcastOption,
    isGasTank: false,
    inToken: '0x0000000000000000000000000000000000000000',
    feeTokenChainId: 1n,
    amount: 1n,
    simulatedGasLimit: 1n,
    gasPrice: 1n
  },
  ...overrides
})

const makeOp = (status: AccountOpStatus, overrides: Partial<SubmittedAccountOp> = {}) =>
  ({
    id: `${status}-${Math.random()}`,
    accountAddr: ACCOUNT,
    chainId: 8453n,
    nonce: 0n,
    status,
    timestamp: 0,
    ...overrides
  }) as SubmittedAccountOp

const makeAccount = (type: 'eoa' | 'ambire' | 'safe'): Account => ({
  addr: ACCOUNT,
  associatedKeys: [PAYER],
  initialPrivileges: [],
  creation:
    type === 'ambire'
      ? { factoryAddr: PAYER, bytecode: '0x00', salt: `0x${'0'.repeat(64)}` }
      : null,
  ...(type === 'safe' && {
    safeCreation: { factoryAddr: PAYER, singleton: PAYER, saltNonce: '0x00', setupData: '0x' }
  }),
  preferences: { label: 'Account', pfp: ACCOUNT }
})

/** A pending op of ACCOUNT on chain 8453 whose first raw txn took the sender nonce 7 */
const makeSentOp = (broadcastOption: string, overrides: Partial<SubmittedAccountOp> = {}) =>
  makeOp(AccountOpStatus.BroadcastedButNotConfirmed, {
    nonce: 3n,
    gasFeePayment: makeAccountOp(broadcastOption).gasFeePayment,
    eoaNonce: 7n,
    identifiedBy: { type: 'Transaction', identifier: '0x01' },
    ...overrides
  })

const sender = (nonce: bigint, addr = ACCOUNT): ReservedNonce => ({ kind: 'sender', addr, nonce })
const account = (nonce: bigint, addr = ACCOUNT): ReservedNonce => ({ kind: 'account', addr, nonce })

describe('utils/nonce', () => {
  describe('getSubmittedAccountOpNonces', () => {
    const cases: {
      name: string
      op: SubmittedAccountOp
      accountType: 'eoa' | 'ambire' | 'safe'
      expected: ReservedNonce[]
    }[] = [
      {
        name: 'bySelf: the sender nonce of its txn',
        op: makeSentOp(BROADCAST_OPTIONS.bySelf),
        accountType: 'eoa',
        expected: [sender(7n)]
      },
      {
        name: 'bySelf batch of 3 with 2 sent: only the nonces of the sent txns',
        op: makeSentOp(BROADCAST_OPTIONS.bySelf, {
          identifiedBy: { type: 'MultipleTxns', identifier: '0x01-0x02' }
        }),
        accountType: 'eoa',
        expected: [sender(7n), sender(8n)]
      },
      {
        name: 'bySelf7702: sender nonce only',
        op: makeSentOp(BROADCAST_OPTIONS.bySelf7702),
        accountType: 'eoa',
        expected: [sender(7n)]
      },
      {
        name: 'self delegation: the txn nonce and the authorization nonce',
        op: makeSentOp(BROADCAST_OPTIONS.delegation),
        accountType: 'eoa',
        expected: [sender(7n), sender(8n)]
      },
      {
        name: 'Ambire account paid by another EOA: payer and account nonce',
        op: makeSentOp(BROADCAST_OPTIONS.byOtherEOA),
        accountType: 'ambire',
        expected: [sender(7n, PAYER), account(3n)]
      },
      {
        name: 'a raw txn without a saved sender nonce: no sender nonce',
        op: makeSentOp(BROADCAST_OPTIONS.byOtherEOA, { eoaNonce: undefined }),
        accountType: 'ambire',
        expected: [account(3n)]
      },
      {
        name: 'relayer: account nonce only',
        op: makeSentOp(BROADCAST_OPTIONS.byRelayer),
        accountType: 'ambire',
        expected: [account(3n)]
      },
      {
        name: 'Ambire bundler op: nothing, as its nonce is the userOp nonce',
        op: makeSentOp(BROADCAST_OPTIONS.byBundler),
        accountType: 'ambire',
        expected: []
      },
      {
        name: 'EOA7702 bundler op with an authorization: the authorization nonce',
        op: makeSentOp(BROADCAST_OPTIONS.byBundler, {
          asUserOperation: {
            eip7702Auth: { nonce: '0x5' }
          } as unknown as SubmittedAccountOp['asUserOperation']
        }),
        accountType: 'eoa',
        expected: [sender(5n)]
      },
      {
        name: 'Safe through a bundler: the Safe nonce',
        op: makeSentOp(BROADCAST_OPTIONS.byBundler),
        accountType: 'safe',
        expected: [account(3n)]
      },
      {
        name: 'Safe: safeTx.nonce wins over nonce',
        op: makeSentOp(BROADCAST_OPTIONS.byOtherEOA, {
          safeTx: { nonce: '9' } as AccountOp['safeTx']
        }),
        accountType: 'safe',
        expected: [sender(7n, PAYER), account(9n)]
      },
      {
        name: 'Safe deploy: no Safe nonce, as a deploy only calls the factory',
        op: makeSentOp(BROADCAST_OPTIONS.byOtherEOA, { meta: { isSafeDeploy: true } }),
        accountType: 'safe',
        expected: [sender(7n, PAYER)]
      },
      {
        name: 'null nonce: no account entry',
        op: makeSentOp(BROADCAST_OPTIONS.byRelayer, { nonce: null as unknown as bigint }),
        accountType: 'ambire',
        expected: []
      }
    ]

    it.each(cases)('$name', ({ op, accountType, expected }) => {
      expect(getSubmittedAccountOpNonces(op, makeAccount(accountType))).toEqual(expected)
    })
  })

  describe('getPendingNonceReservations and getNextNonce', () => {
    const OTHER = '0x1111111111111111111111111111111111111111'
    const otherAccount: Account = { ...makeAccount('ambire'), addr: OTHER }
    const accounts = [makeAccount('eoa'), otherAccount]
    const chainId = 8453n
    const NOW = 1_700_000_000_000
    const nextNonce = (
      key: NonceKey,
      chainNonce: bigint,
      accountOps: SubmittedAccountOp[],
      now = Date.now()
    ) => getNextNonce({ ...key, chainId, chainNonce, accountOps, now, accounts })

    it('is the chain nonce when nothing is pending', () => {
      expect(nextNonce({ kind: 'sender', addr: ACCOUNT }, 7n, [])).toBe(7n)
    })

    it('goes past a pending txn the RPC does not count, so it is not replaced by accident', () => {
      const stuck = makeSentOp(BROADCAST_OPTIONS.bySelf)
      expect(nextNonce({ kind: 'sender', addr: ACCOUNT }, 7n, [stuck])).toBe(8n)
    })

    it('goes past every txn of a pending batch', () => {
      const batch = makeSentOp(BROADCAST_OPTIONS.bySelf, {
        identifiedBy: { type: 'MultipleTxns', identifier: '0x01-0x02-0x03' }
      })
      expect(nextNonce({ kind: 'sender', addr: ACCOUNT }, 7n, [batch])).toBe(10n)
    })

    it('keeps the chain nonce when the chain is already past the pending ops', () => {
      const mined = makeSentOp(BROADCAST_OPTIONS.bySelf)
      expect(nextNonce({ kind: 'sender', addr: ACCOUNT }, 12n, [mined])).toBe(12n)
    })

    it('counts the txns an EOA sends for another account, as they take its nonce too', () => {
      // OTHER is a smart account whose txn the EOA PAYER pays for and sends
      const sentByPayer = makeSentOp(BROADCAST_OPTIONS.byOtherEOA, { accountAddr: OTHER })

      expect(nextNonce({ kind: 'sender', addr: PAYER }, 7n, [sentByPayer])).toBe(8n)
      expect(
        getPendingNonceReservations({
          chainId,
          keys: [{ kind: 'sender', addr: PAYER }],
          pendingAccountOps: [sentByPayer],
          accounts
        })
      ).toEqual([{ accountOpId: sentByPayer.id, reserved: sender(7n, PAYER) }])
    })

    it('ignores ops of another kind, sender, chain, or of an account not in the wallet', () => {
      const pendingAccountOps = [
        makeSentOp(BROADCAST_OPTIONS.bySelf, { eoaNonce: 20n }),
        makeSentOp(BROADCAST_OPTIONS.bySelf, { eoaNonce: 30n, chainId: 1n }),
        makeSentOp(BROADCAST_OPTIONS.byOtherEOA, {
          accountAddr: '0x2222222222222222222222222222222222222222',
          eoaNonce: 40n
        })
      ]

      expect(nextNonce({ kind: 'account', addr: ACCOUNT }, 7n, pendingAccountOps)).toBe(7n)
      expect(nextNonce({ kind: 'sender', addr: OTHER }, 7n, pendingAccountOps)).toBe(7n)
      expect(nextNonce({ kind: 'sender', addr: PAYER }, 7n, pendingAccountOps)).toBe(7n)
      expect(nextNonce({ kind: 'sender', addr: ACCOUNT }, 7n, pendingAccountOps)).toBe(21n)
    })

    it('holds the nonce of a mined op until the settle time has passed', () => {
      const mined = makeSentOp(BROADCAST_OPTIONS.bySelf, {
        status: AccountOpStatus.Success,
        confirmedAt: NOW
      })
      const key: NonceKey = { kind: 'sender', addr: ACCOUNT }

      expect(nextNonce(key, 7n, [mined], NOW + CONFIRMED_NONCE_SETTLE_MS - 1000)).toBe(8n)
      expect(nextNonce(key, 7n, [mined], NOW + CONFIRMED_NONCE_SETTLE_MS)).toBe(7n)
    })

    it('holds only the payer nonce of a reverted op, as the account nonce is not raised', () => {
      const reverted = makeSentOp(BROADCAST_OPTIONS.byOtherEOA, {
        accountAddr: OTHER,
        status: AccountOpStatus.Failure,
        confirmedAt: NOW
      })

      expect(nextNonce({ kind: 'sender', addr: PAYER }, 7n, [reverted], NOW)).toBe(8n)
      expect(nextNonce({ kind: 'account', addr: OTHER }, 3n, [reverted], NOW)).toBe(3n)
    })

    it('holds only the lowest nonces of a batch when its last txn was never mined', () => {
      const batch = makeSentOp(BROADCAST_OPTIONS.bySelf, {
        status: AccountOpStatus.Failure,
        confirmedAt: NOW,
        identifiedBy: { type: 'MultipleTxns', identifier: '0x01-0x02-0x03' },
        calls: [
          { status: AccountOpStatus.Success },
          { status: AccountOpStatus.Failure },
          { status: AccountOpStatus.BroadcastedButNotConfirmed }
        ] as SubmittedAccountOp['calls']
      })

      expect(nextNonce({ kind: 'sender', addr: ACCOUNT }, 7n, [batch], NOW)).toBe(9n)
    })

    it('holds nothing for a mined op without a confirmation time', () => {
      const mined = makeSentOp(BROADCAST_OPTIONS.bySelf, { status: AccountOpStatus.Success })

      expect(nextNonce({ kind: 'sender', addr: ACCOUNT }, 7n, [mined], NOW)).toBe(7n)
    })
  })

  describe('getNonceKeys', () => {
    const senderKey = (addr = ACCOUNT): NonceKey => ({ kind: 'sender', addr })
    const accountKey: NonceKey = { kind: 'account', addr: ACCOUNT }
    const cases: {
      name: string
      args: Parameters<typeof getNonceKeys>[0]
      expected: NonceKey[]
    }[] = [
      {
        name: 'an EOA sends by itself',
        args: {
          accountOp: makeAccountOp(BROADCAST_OPTIONS.bySelf, { gasFeePayment: null }),
          account: makeAccount('eoa')
        },
        expected: [senderKey()]
      },
      {
        name: 'a 7702 delegation is sent by the account',
        args: {
          accountOp: makeAccountOp(BROADCAST_OPTIONS.delegation),
          account: makeAccount('eoa')
        },
        expected: [senderKey()]
      },
      {
        name: 'a smart account paid by an EOA takes the payer nonce and its own',
        args: {
          accountOp: makeAccountOp(BROADCAST_OPTIONS.byOtherEOA),
          account: makeAccount('ambire')
        },
        expected: [senderKey(PAYER), accountKey]
      },
      {
        name: 'a smart account through the Relayer takes its own nonce',
        args: {
          accountOp: makeAccountOp(BROADCAST_OPTIONS.byRelayer),
          account: makeAccount('ambire')
        },
        expected: [accountKey]
      },
      {
        name: 'a smart account through a bundler takes no wallet nonce',
        args: {
          accountOp: makeAccountOp(BROADCAST_OPTIONS.byBundler),
          account: makeAccount('ambire')
        },
        expected: []
      },
      {
        name: 'an EOA through a bundler takes its own txn nonce when it signs the 7702 authorization',
        args: {
          accountOp: makeAccountOp(BROADCAST_OPTIONS.byBundler),
          account: makeAccount('eoa'),
          signsBundlerAuthorization: true
        },
        expected: [senderKey()]
      },
      {
        name: 'a smart account without a fee option yet takes no wallet nonce',
        args: {
          accountOp: makeAccountOp(BROADCAST_OPTIONS.byOtherEOA, { gasFeePayment: null }),
          account: makeAccount('ambire')
        },
        expected: []
      },
      {
        name: 'a Safe through a bundler still takes its Safe nonce',
        args: {
          accountOp: makeAccountOp(BROADCAST_OPTIONS.byBundler),
          account: makeAccount('safe')
        },
        expected: [accountKey]
      },
      {
        name: 'a Safe executed by an EOA takes the payer nonce and the Safe nonce',
        args: {
          accountOp: makeAccountOp(BROADCAST_OPTIONS.byOtherEOA),
          account: makeAccount('safe')
        },
        expected: [senderKey(PAYER), accountKey]
      },
      {
        name: 'a Safe without a fee option yet takes its Safe nonce',
        args: {
          accountOp: makeAccountOp(BROADCAST_OPTIONS.byOtherEOA, { gasFeePayment: null }),
          account: makeAccount('safe')
        },
        expected: [accountKey]
      },
      {
        name: 'a Safe deploy takes no Safe nonce',
        args: {
          accountOp: makeAccountOp(BROADCAST_OPTIONS.byBundler, { meta: { isSafeDeploy: true } }),
          account: makeAccount('safe')
        },
        expected: []
      }
    ]

    it.each(cases)('$name', ({ args, expected }) => {
      expect(getNonceKeys(args)).toEqual(expected)
    })
  })

  describe('getReceiptBlockNumberByChainId', () => {
    it('keeps the highest receipt block per chain and skips ops without a receipt', () => {
      const ops = [
        makeOp(AccountOpStatus.Success, { chainId: 1n, blockNumber: 10 }),
        makeOp(AccountOpStatus.Success, { chainId: 1n, blockNumber: 12 }),
        makeOp(AccountOpStatus.Failure, { chainId: 8453n, blockNumber: 0 }),
        makeOp(AccountOpStatus.Rejected, { chainId: 10n })
      ]
      expect(getReceiptBlockNumberByChainId(ops)).toEqual({ '1': 12, '8453': 0 })
    })
  })
})
