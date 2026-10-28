import { describe, expect, test } from '@jest/globals'

import { SubmittedAccountOpLike } from '../accountOp/submittedAccountOp'
import { AccountOpStatus } from '../accountOp/types'
import {
  collapseReplacedAccountOps,
  findAccountOpOrReplacement,
  getReplacementKey
} from './replacements'

const ACCOUNT = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
const OTHER_EOA = '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175'

const buildOp = (params: {
  id: string
  status?: AccountOpStatus
  timestamp?: number
  eoaNonce?: bigint | null
  paidBy?: string
  chainId?: bigint
}): SubmittedAccountOpLike => {
  const {
    id,
    status = AccountOpStatus.BroadcastedButNotConfirmed,
    timestamp = 0,
    paidBy = ACCOUNT,
    chainId = 1n
  } = params
  // Not a destructuring default, as that would also replace an explicit `eoaNonce: undefined`
  const eoaNonce = 'eoaNonce' in params ? params.eoaNonce : 5n

  return {
    id,
    accountAddr: ACCOUNT,
    chainId,
    calls: [],
    status,
    timestamp,
    eoaNonce,
    identifiedBy: { type: 'Transaction', identifier: id },
    gasFeePayment: {
      paidBy,
      isGasTank: false,
      inToken: '0x0000000000000000000000000000000000000000',
      amount: 1n,
      simulatedGasLimit: 1n,
      gasPrice: 1n,
      broadcastOption: 'bySelf',
      paidByKeyType: 'internal'
    }
  } as SubmittedAccountOpLike
}

const ids = (ops: SubmittedAccountOpLike[]) => ops.map((op) => op.id)

describe('getReplacementKey', () => {
  test('is the same for ops of the same payer, nonce and network', () => {
    expect(getReplacementKey(buildOp({ id: 'a' }))).toBe(getReplacementKey(buildOp({ id: 'b' })))
  })

  test('ignores the casing of the payer address', () => {
    expect(getReplacementKey(buildOp({ id: 'a', paidBy: ACCOUNT.toLowerCase() }))).toBe(
      getReplacementKey(buildOp({ id: 'b', paidBy: ACCOUNT }))
    )
  })

  test.each([
    ['nonce', { eoaNonce: 6n }],
    ['payer', { paidBy: OTHER_EOA }],
    ['network', { chainId: 10n }]
  ])('differs when the %s differs', (_, overrides) => {
    expect(getReplacementKey(buildOp({ id: 'a' }))).not.toBe(
      getReplacementKey(buildOp({ id: 'b', ...overrides }))
    )
  })

  test.each([undefined, null])('is null when the nonce is %s', (eoaNonce) => {
    expect(getReplacementKey(buildOp({ id: 'a', eoaNonce }))).toBeNull()
  })

  test('is null when there is no fee payment', () => {
    expect(getReplacementKey({ ...buildOp({ id: 'a' }), gasFeePayment: null })).toBeNull()
  })
})

describe('collapseReplacedAccountOps', () => {
  test('keeps the newest op while all of them are pending', () => {
    const ops = [
      buildOp({ id: 'speed-up-2', timestamp: 3 }),
      buildOp({ id: 'speed-up-1', timestamp: 2 }),
      buildOp({ id: 'original', timestamp: 1 })
    ]

    expect(ids(collapseReplacedAccountOps(ops))).toEqual(['speed-up-2'])
  })

  test.each([AccountOpStatus.Success, AccountOpStatus.Failure])(
    'keeps the op that got onchain with the %s status, even if older',
    (status) => {
      const ops = [
        buildOp({ id: 'speed-up', timestamp: 2, status: AccountOpStatus.UnknownButPastNonce }),
        buildOp({ id: 'original', timestamp: 1, status })
      ]

      expect(ids(collapseReplacedAccountOps(ops))).toEqual(['original'])
    }
  )

  test('keeps the speed up that got confirmed and hides the replaced original', () => {
    const ops = [
      buildOp({ id: 'speed-up', timestamp: 2, status: AccountOpStatus.Success }),
      buildOp({ id: 'original', timestamp: 1, status: AccountOpStatus.UnknownButPastNonce })
    ]

    expect(ids(collapseReplacedAccountOps(ops))).toEqual(['speed-up'])
  })

  test('does not prefer a stuck op over a newer pending one', () => {
    const ops = [
      buildOp({ id: 'speed-up', timestamp: 2 }),
      buildOp({ id: 'original', timestamp: 1, status: AccountOpStatus.BroadcastButStuck })
    ]

    expect(ids(collapseReplacedAccountOps(ops))).toEqual(['speed-up'])
  })

  test('keeps ops of different groups and ops without a group, in their order', () => {
    const ops = [
      buildOp({ id: 'no-nonce', timestamp: 5, eoaNonce: undefined }),
      buildOp({ id: 'nonce-6', timestamp: 4, eoaNonce: 6n }),
      buildOp({ id: 'nonce-5-speed-up', timestamp: 3 }),
      buildOp({ id: 'other-payer', timestamp: 2, paidBy: OTHER_EOA }),
      buildOp({ id: 'nonce-5-original', timestamp: 1 })
    ]

    expect(ids(collapseReplacedAccountOps(ops))).toEqual([
      'no-nonce',
      'nonce-6',
      'nonce-5-speed-up',
      'other-payer'
    ])
  })

  test('returns an empty list for no ops', () => {
    expect(collapseReplacedAccountOps([])).toEqual([])
  })
})

describe('findAccountOpOrReplacement', () => {
  test('finds the op itself while it is the one shown', () => {
    const original = buildOp({ id: 'original', timestamp: 1 })

    expect(findAccountOpOrReplacement([original], original)?.id).toBe('original')
  })

  test('finds the speed up that is shown in place of the op', () => {
    const original = buildOp({ id: 'original', timestamp: 1 })
    const ops = collapseReplacedAccountOps([buildOp({ id: 'speed-up', timestamp: 2 }), original])

    expect(findAccountOpOrReplacement(ops, original)?.id).toBe('speed-up')
  })

  test('does not match an op of another payer, nonce or network', () => {
    const original = buildOp({ id: 'original' })
    const ops = [
      buildOp({ id: 'other-payer', paidBy: OTHER_EOA }),
      buildOp({ id: 'other-nonce', eoaNonce: 6n }),
      buildOp({ id: 'other-network', chainId: 10n })
    ]

    expect(findAccountOpOrReplacement(ops, original)).toBeUndefined()
  })

  test('matches an op that cannot be replaced by its signature', () => {
    const tracked = { ...buildOp({ id: 'tracked', eoaNonce: undefined }), signature: '0xaa' }
    const ops = [
      { ...buildOp({ id: 'other', eoaNonce: undefined }), signature: '0xbb' },
      { ...buildOp({ id: 'same', eoaNonce: undefined }), signature: '0xaa' }
    ]

    expect(findAccountOpOrReplacement(ops, tracked)?.id).toBe('same')
  })

  test('matches nothing for an op that cannot be replaced and has no signature', () => {
    const tracked = buildOp({ id: 'tracked', eoaNonce: undefined })
    const ops = [buildOp({ id: 'other', eoaNonce: undefined })]

    expect(findAccountOpOrReplacement(ops, tracked)).toBeUndefined()
  })
})
