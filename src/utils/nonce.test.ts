import { toBeHex } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { IActivityController } from '../interfaces/activity'
import { RPCProvider } from '../interfaces/provider'
import { AccountOp } from '../libs/accountOp/accountOp'
import { SubmittedAccountOp } from '../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../libs/accountOp/types'
import { BROADCAST_OPTIONS } from '../libs/broadcast/broadcast'
import {
  getAccountNonceWithLocalFloor,
  getLocalNonceFloor,
  getRelayerNonce,
  LOCAL_NONCE_FLOOR_CONFIRMED_WINDOW_MS,
  LocalNonceFloorKind
} from './nonce'

const NOW = 1_700_000_000_000
const ACCOUNT = '0xa07D75aacEFd11b425AF7181958F0F85c312f143'
const PAYER = '0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'
const OTHER_ACCOUNT = '0x6C0937c7a04487573673a47F22E4Af9e96b91ecd'

type OpOverrides = Partial<SubmittedAccountOp> & {
  broadcastOption?: string
  paidBy?: string
}

let opCount = 0
const makeOp = ({
  broadcastOption = BROADCAST_OPTIONS.byRelayer,
  paidBy = ACCOUNT,
  ...overrides
}: OpOverrides = {}): SubmittedAccountOp => {
  opCount += 1
  return {
    id: `op-${opCount}`,
    accountAddr: ACCOUNT,
    chainId: 1n,
    signingKeyAddr: PAYER,
    signingKeyType: 'internal',
    nonce: 5n,
    calls: [{ to: OTHER_ACCOUNT, value: 0n, data: '0x' }],
    gasLimit: null,
    signature: '0x',
    gasFeePayment: {
      isGasTank: false,
      paidBy,
      paidByKeyType: 'internal',
      inToken: '0x0000000000000000000000000000000000000000',
      amount: 1n,
      simulatedGasLimit: 1n,
      gasPrice: 1n,
      broadcastOption
    },
    status: AccountOpStatus.BroadcastedButNotConfirmed,
    identifiedBy: { type: 'Transaction', identifier: `0x${opCount}` },
    timestamp: NOW - 1000,
    ...overrides
  }
}

const AMBIRE_V1: LocalNonceFloorKind = { type: 'ambire', countRelayerOps: true }
const AMBIRE_V2: LocalNonceFloorKind = { type: 'ambire', countRelayerOps: false }
const EOA: LocalNonceFloorKind = { type: 'eoa' }
const SAFE: LocalNonceFloorKind = { type: 'safe' }

describe('getLocalNonceFloor', () => {
  test.each<[string, OpOverrides, string, LocalNonceFloorKind, bigint | null]>([
    ['counts a pending op', {}, ACCOUNT, AMBIRE_V1, 6n],
    [
      'ignores a relayer op of a V2 account, as the relayer picks its nonce',
      {},
      ACCOUNT,
      AMBIRE_V2,
      null
    ],
    [
      'ignores a bundler op of an Ambire account, as its nonce key is random',
      { broadcastOption: BROADCAST_OPTIONS.byBundler },
      ACCOUNT,
      AMBIRE_V1,
      null
    ],
    [
      'counts a bundler op of a Safe, which stores the Safe nonce',
      { broadcastOption: BROADCAST_OPTIONS.byBundler },
      ACCOUNT,
      SAFE,
      6n
    ],
    [
      'counts the account nonce of an op paid by one of its EOA keys',
      { broadcastOption: BROADCAST_OPTIONS.byOtherEOA, paidBy: PAYER, eoaNonce: 40n },
      ACCOUNT,
      AMBIRE_V1,
      6n
    ],
    [
      'counts an op confirmed just inside the window',
      {
        status: AccountOpStatus.Success,
        timestamp: NOW - LOCAL_NONCE_FLOOR_CONFIRMED_WINDOW_MS + 1
      },
      ACCOUNT,
      AMBIRE_V1,
      6n
    ],
    [
      'ignores an op confirmed before the window, as the RPC counts it by then',
      {
        status: AccountOpStatus.Success,
        timestamp: NOW - LOCAL_NONCE_FLOOR_CONFIRMED_WINDOW_MS - 1
      },
      ACCOUNT,
      AMBIRE_V1,
      null
    ],
    [
      'ignores a reverted smart account op, as the revert undoes the nonce raise',
      { status: AccountOpStatus.Failure },
      ACCOUNT,
      AMBIRE_V1,
      null
    ],
    [
      'counts a reverted EOA txn, which still used its nonce',
      { status: AccountOpStatus.Failure, broadcastOption: BROADCAST_OPTIONS.bySelf, eoaNonce: 5n },
      ACCOUNT,
      EOA,
      6n
    ],
    [
      'ignores a rejected op, which never reached the chain',
      { status: AccountOpStatus.Rejected, broadcastOption: BROADCAST_OPTIONS.bySelf, eoaNonce: 5n },
      ACCOUNT,
      EOA,
      null
    ],
    [
      'counts one EOA nonce per txn of a batch sent one txn at a time',
      {
        broadcastOption: BROADCAST_OPTIONS.bySelf,
        eoaNonce: 5n,
        identifiedBy: { type: 'MultipleTxns', identifier: '0x1-0x2-0x3' },
        calls: [1n, 2n, 3n].map((value) => ({ to: OTHER_ACCOUNT, value, data: '0x' as const }))
      },
      ACCOUNT,
      EOA,
      8n
    ],
    [
      'counts the op of another account that the sender EOA paid for, in any letter case',
      { broadcastOption: BROADCAST_OPTIONS.byOtherEOA, paidBy: PAYER.toLowerCase(), eoaNonce: 9n },
      PAYER,
      EOA,
      10n
    ],
    [
      'ignores an op that another EOA paid for',
      { broadcastOption: BROADCAST_OPTIONS.byOtherEOA, paidBy: PAYER, eoaNonce: 9n },
      ACCOUNT,
      EOA,
      null
    ],
    ['ignores the op of another account', { accountAddr: OTHER_ACCOUNT }, ACCOUNT, AMBIRE_V1, null]
  ])('%s', (_, overrides, sender, kind, expectedFloor) => {
    expect(getLocalNonceFloor([makeOp(overrides)], sender, kind, NOW)).toBe(expectedFloor)
  })

  test('returns the nonce after the highest one of every counted op', () => {
    const ops = [
      makeOp({ nonce: 9n }),
      makeOp({ nonce: 11n, status: AccountOpStatus.Success }),
      makeOp({ nonce: 7n }),
      // Higher, but not counted
      makeOp({ nonce: 30n, status: AccountOpStatus.Failure }),
      makeOp({ nonce: 40n, accountAddr: OTHER_ACCOUNT })
    ]

    expect(getLocalNonceFloor(ops, ACCOUNT, AMBIRE_V1, NOW)).toBe(12n)
  })
})

describe('getAccountNonceWithLocalFloor', () => {
  const ambireAccount = {
    addr: ACCOUNT,
    creation: { factoryAddr: OTHER_ACCOUNT, bytecode: '0x', salt: '0x' }
  }
  const ops = [
    makeOp({ nonce: 10n, broadcastOption: BROADCAST_OPTIONS.byRelayer }),
    makeOp({ nonce: 12n, broadcastOption: BROADCAST_OPTIONS.byBundler })
  ]

  test('raises the RPC nonce by the rules of the account type, and never lowers it', () => {
    // An EOA picks its nonce on broadcast, so the account nonce is left as it is
    expect(getAccountNonceWithLocalFloor({ addr: ACCOUNT, creation: null }, false, ops, 3n)).toBe(
      3n
    )
    // V1 counts relayer ops but not the bundler op with a random nonce key
    expect(getAccountNonceWithLocalFloor(ambireAccount, false, ops, 3n)).toBe(11n)
    // V2 leaves the relayer ops to the relayer
    expect(getAccountNonceWithLocalFloor(ambireAccount, true, ops, 3n)).toBe(3n)
    expect(
      getAccountNonceWithLocalFloor(
        {
          addr: ACCOUNT,
          creation: null,
          safeCreation: {
            factoryAddr: OTHER_ACCOUNT,
            singleton: OTHER_ACCOUNT,
            saltNonce: '0x00',
            setupData: '0x'
          }
        },
        false,
        ops,
        3n
      )
    ).toBe(13n)
    // An RPC that already counts the ops keeps its nonce, a higher one would leave a gap
    expect(getAccountNonceWithLocalFloor(ambireAccount, false, ops, 15n)).toBe(15n)
  })
})

describe('getRelayerNonce', () => {
  const op: AccountOp = {
    id: 'new-op',
    accountAddr: ACCOUNT,
    chainId: 1n,
    signingKeyAddr: PAYER,
    signingKeyType: 'internal',
    nonce: 5n,
    calls: [],
    gasLimit: null,
    signature: null,
    gasFeePayment: null
  }

  const run = (ops: SubmittedAccountOp[], readPendingNonce: () => Promise<string>) => {
    const activity = {
      getAccountOpsForChain: (chainId: bigint, accountAddr?: string) =>
        ops.filter(
          (o) =>
            o.chainId === chainId &&
            (!accountAddr || o.accountAddr.toLowerCase() === accountAddr.toLowerCase())
        )
    } as unknown as IActivityController
    const send = jest.fn(readPendingNonce)
    const provider = { send } as unknown as RPCProvider
    return { nonce: getRelayerNonce(activity, op, provider), send }
  }

  test('keeps the op nonce when no local op of the account on its chain is above it', async () => {
    const { nonce, send } = run(
      [
        makeOp({ nonce: 3n }),
        makeOp({ nonce: 50n, chainId: 10n }),
        makeOp({ nonce: 60n, accountAddr: OTHER_ACCOUNT })
      ],
      async () => '0x0'
    )

    expect(await nonce).toBe(5n)
    expect(send).not.toHaveBeenCalled()
  })

  test('uses the pending RPC nonce when it already counts the local ops', async () => {
    const { nonce } = run([makeOp({ nonce: 7n })], async () => toBeHex(9n))

    expect(await nonce).toBe(9n)
  })

  test('falls back to the local floor when the pending RPC read fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { nonce } = run(
      [
        makeOp({ nonce: 7n, timestamp: NOW - 2000 }),
        // A newer failure on another chain says nothing about the nonce on this one
        makeOp({ nonce: 2n, chainId: 10n, status: AccountOpStatus.Failure, timestamp: NOW })
      ],
      async () => {
        throw new Error('missing trie node')
      }
    )

    await expect(nonce).resolves.toBe(8n)
    expect(consoleError).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })
})
