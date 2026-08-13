import { getAddress } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { buildSafeMessageOrigin, getPreferredSafeRequest, parseSafeMessageOrigin } from './helpers'
import {
  getSafeAccountByOwner,
  getSequentialSafeAccountOps,
  normalizeSafeGlobalMessage
} from './safe'

import type { SafeCreationInfoResponse, SafeInfoResponse } from '@safe-global/api-kit'
import type { EIP712TypedData } from '@safe-global/types-kit'
import type { Hex } from '../../interfaces/hex'
import type { CallsUserRequest, UserRequest } from '../../interfaces/userRequest'

const OWNER: Hex = '0xD8293ad21678c6F09Da139b4B62D38e514a03B78'
const OTHER_OWNER = '0x94b0080A00579C1307B0eF2C499AD98A8ce58e58'
const SAFE_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

const makeCallsRequest = ({
  id,
  nonce,
  accountAddr = SAFE_ADDRESS,
  chainId = 1n,
  isSafeRejected = false,
  signed,
  submissionDate
}: {
  id: string
  nonce: bigint | null
  accountAddr?: string
  chainId?: bigint
  isSafeRejected?: boolean
  signed?: string[]
  submissionDate?: string
}): CallsUserRequest => {
  const signAccountOp = {
    account: { addr: accountAddr },
    accountOp: {
      id,
      accountAddr,
      chainId,
      nonce,
      signed,
      safeTx: submissionDate ? { submissionDate } : undefined
    }
  } as unknown as CallsUserRequest['signAccountOp']

  return {
    id,
    kind: 'calls',
    meta: { isSafeRejected, accountAddr, chainId },
    dappPromises: [],
    signAccountOp
  }
}

const getSafeInfo = (owners: string[] = [OWNER]): SafeInfoResponse => ({
  address: SAFE_ADDRESS,
  fallbackHandler: '0x0000000000000000000000000000000000000000',
  guard: '0x0000000000000000000000000000000000000000',
  singleton: '0x0000000000000000000000000000000000000000',
  modules: [],
  nonce: '0',
  owners,
  threshold: 1,
  version: '1.4.1'
})

const getSafeCreationInfo = (): SafeCreationInfoResponse => ({
  created: '2025-01-01T00:00:00Z',
  creator: OWNER,
  factoryAddress: '0x1234567890123456789012345678901234567890',
  saltNonce: '1',
  setupData: '0x1234',
  singleton: '0x2345678901234567890123456789012345678901',
  transactionHash: `0x${'1'.repeat(64)}`,
  userOperation: null
})

const createApi = (owners: string[] = [OWNER]) => ({
  getSafeCreationInfo: jest.fn(async () => getSafeCreationInfo()),
  getSafeInfo: jest.fn(async () => getSafeInfo(owners))
})

describe('getSequentialSafeAccountOps', () => {
  test('sorts account ops by nonce and removes the first account op after a gap', () => {
    const currentRequest = makeCallsRequest({ id: 'current', nonce: 131n })
    const requests = [
      makeCallsRequest({ id: 'nonce-134', nonce: 134n }),
      currentRequest,
      makeCallsRequest({ id: 'nonce-132', nonce: 132n })
    ]

    expect(
      getSequentialSafeAccountOps(requests, currentRequest, 131n).map(({ nonce }) => nonce)
    ).toEqual([131n, 132n])
  })

  test('keeps all account ops when every nonce is incremental', () => {
    const currentRequest = makeCallsRequest({ id: 'current', nonce: 131n })
    const requests = [134n, 132n, 131n, 133n].map((nonce) =>
      makeCallsRequest({ id: `nonce-${nonce}`, nonce })
    )

    expect(
      getSequentialSafeAccountOps(requests, currentRequest, 131n).map(({ nonce }) => nonce)
    ).toEqual([131n, 132n, 133n, 134n])
  })

  test('removes every account op after the first nonce gap', () => {
    const currentRequest = makeCallsRequest({ id: 'current', nonce: 131n })
    const requests = [139n, 133n, 137n, 132n, 138n, 131n, 134n].map((nonce) =>
      makeCallsRequest({ id: `nonce-${nonce}`, nonce })
    )

    expect(
      getSequentialSafeAccountOps(requests, currentRequest, 131n).map(({ nonce }) => nonce)
    ).toEqual([131n, 132n, 133n, 134n])
  })

  test('keeps one of the account ops with a duplicate nonce and every account op after them', () => {
    const currentRequest = makeCallsRequest({ id: 'nonce-132', nonce: 132n })
    const requests = [
      makeCallsRequest({ id: 'nonce-134', nonce: 134n }),
      makeCallsRequest({ id: 'first-nonce-133', nonce: 133n }),
      currentRequest,
      makeCallsRequest({ id: 'second-nonce-133', nonce: 133n })
    ]

    expect(getSequentialSafeAccountOps(requests, currentRequest, 132n).map(({ id }) => id)).toEqual(
      ['nonce-132', 'first-nonce-133', 'nonce-134']
    )
  })

  test('keeps one of the account ops when the first nonce is duplicated', () => {
    const currentRequest = makeCallsRequest({ id: 'first-nonce-132', nonce: 132n })
    const requests = [
      makeCallsRequest({ id: 'nonce-135', nonce: 135n }),
      currentRequest,
      makeCallsRequest({ id: 'nonce-134', nonce: 134n }),
      makeCallsRequest({ id: 'nonce-133', nonce: 133n }),
      makeCallsRequest({ id: 'second-nonce-132', nonce: 132n })
    ]

    expect(getSequentialSafeAccountOps(requests, currentRequest, 132n).map(({ id }) => id)).toEqual(
      ['first-nonce-132', 'nonce-133', 'nonce-134', 'nonce-135']
    )
  })

  test('keeps the account op with the most signatures of a duplicated nonce', () => {
    const currentRequest = makeCallsRequest({ id: 'one-signature', nonce: 132n, signed: [OWNER] })
    const requests = [
      currentRequest,
      makeCallsRequest({
        id: 'two-signatures',
        nonce: 132n,
        signed: [OWNER, OTHER_OWNER]
      })
    ]

    expect(getSequentialSafeAccountOps(requests, currentRequest, 132n).map(({ id }) => id)).toEqual(
      ['two-signatures']
    )
  })

  test('returns no account ops when there is no transaction for the account state nonce', () => {
    const currentRequest = makeCallsRequest({ id: 'nonce-132', nonce: 132n })
    const requests = [
      currentRequest,
      makeCallsRequest({ id: 'nonce-133', nonce: 133n }),
      makeCallsRequest({ id: 'nonce-134', nonce: 134n })
    ]

    expect(getSequentialSafeAccountOps(requests, currentRequest, 131n)).toEqual([])
  })

  test('returns no account ops when the account state nonce is unavailable', () => {
    const currentRequest = makeCallsRequest({ id: 'nonce-131', nonce: 131n })

    expect(getSequentialSafeAccountOps([currentRequest], currentRequest, undefined)).toEqual([])
  })

  test('starts from the account state nonce when stale transactions remain', () => {
    const currentRequest = makeCallsRequest({ id: 'nonce-130', nonce: 130n })
    const requests = [
      currentRequest,
      makeCallsRequest({ id: 'nonce-131', nonce: 131n }),
      makeCallsRequest({ id: 'nonce-132', nonce: 132n })
    ]

    expect(
      getSequentialSafeAccountOps(requests, currentRequest, 131n).map(({ nonce }) => nonce)
    ).toEqual([131n, 132n])
  })

  test('only includes non-rejected calls for the current account and network', () => {
    const currentRequest = makeCallsRequest({ id: 'current', nonce: 10n })
    const requests: UserRequest[] = [
      currentRequest,
      makeCallsRequest({ id: 'matching', nonce: 11n }),
      makeCallsRequest({ id: 'rejected', nonce: 12n, isSafeRejected: true }),
      makeCallsRequest({ id: 'other-account', nonce: 12n, accountAddr: OTHER_OWNER }),
      makeCallsRequest({ id: 'other-network', nonce: 12n, chainId: 10n }),
      { id: 'transfer', kind: 'transfer', meta: {}, dappPromises: [] }
    ]

    expect(getSequentialSafeAccountOps(requests, currentRequest, 10n).map(({ id }) => id)).toEqual([
      'current',
      'matching'
    ])
  })

  test('returns no account ops for a current request without an account op', () => {
    const currentRequest: UserRequest = {
      id: 'transfer',
      kind: 'transfer',
      meta: {},
      dappPromises: []
    }

    expect(
      getSequentialSafeAccountOps(
        [makeCallsRequest({ id: 'calls', nonce: 1n })],
        currentRequest,
        1n
      )
    ).toEqual([])
  })

  test('excludes account ops without a nonce and anything beyond the resulting gap', () => {
    const currentRequest = makeCallsRequest({ id: 'current', nonce: 1n })
    const requests = [
      currentRequest,
      makeCallsRequest({ id: 'missing-nonce', nonce: null }),
      makeCallsRequest({ id: 'nonce-3', nonce: 3n })
    ]

    expect(
      getSequentialSafeAccountOps(requests, currentRequest, 1n).map(({ nonce }) => nonce)
    ).toEqual([1n])
  })
})

describe('getPreferredSafeRequest', () => {
  test('prefers the transaction with the most signatures', () => {
    const requests = [
      makeCallsRequest({ id: 'one-signature', nonce: 1n, signed: [OWNER] }),
      makeCallsRequest({ id: 'two-signatures', nonce: 1n, signed: [OWNER, OTHER_OWNER] }),
      makeCallsRequest({ id: 'no-signatures', nonce: 1n })
    ]

    expect(getPreferredSafeRequest(requests)?.id).toBe('two-signatures')
  })

  test('prefers the newest transaction when the signature counts are equal', () => {
    const requests = [
      makeCallsRequest({
        id: 'older',
        nonce: 1n,
        signed: [OWNER],
        submissionDate: '2025-01-01T00:00:00Z'
      }),
      makeCallsRequest({
        id: 'newer',
        nonce: 1n,
        signed: [OWNER],
        submissionDate: '2025-02-01T00:00:00Z'
      })
    ]

    expect(getPreferredSafeRequest(requests)?.id).toBe('newer')
  })

  test('prefers a transaction with a submission date over one without', () => {
    const requests = [
      makeCallsRequest({ id: 'without-date', nonce: 1n }),
      makeCallsRequest({ id: 'with-date', nonce: 1n, submissionDate: '2025-01-01T00:00:00Z' })
    ]

    expect(getPreferredSafeRequest(requests)?.id).toBe('with-date')
  })

  test('picks the same transaction on every run when nothing separates them', () => {
    const requests = [
      makeCallsRequest({ id: 'b', nonce: 1n }),
      makeCallsRequest({ id: 'a', nonce: 1n })
    ]

    expect(getPreferredSafeRequest(requests)?.id).toBe('a')
    expect(getPreferredSafeRequest([...requests].reverse())?.id).toBe('a')
  })

  test('returns nothing for an empty list', () => {
    expect(getPreferredSafeRequest([])).toBeUndefined()
  })
})

describe('getSafeAccountByOwner', () => {
  test('falls back to the next deployed network when fetching Safe details fails', async () => {
    const mainnetApi = createApi()
    mainnetApi.getSafeInfo.mockRejectedValue(new Error('Service unavailable'))
    const optimismApi = createApi()
    const apiKitFactory = jest.fn((chainId: bigint) => (chainId === 1n ? mainnetApi : optimismApi))

    const result = await getSafeAccountByOwner(SAFE_ADDRESS, OWNER, [1n, 10n], apiKitFactory)

    expect(mainnetApi.getSafeInfo).toHaveBeenCalledWith(SAFE_ADDRESS)
    expect(mainnetApi.getSafeCreationInfo).not.toHaveBeenCalled()
    expect(optimismApi.getSafeInfo).toHaveBeenCalledWith(SAFE_ADDRESS)
    expect(optimismApi.getSafeCreationInfo).toHaveBeenCalledWith(SAFE_ADDRESS)
    expect(result.account).toMatchObject({
      addr: getAddress(SAFE_ADDRESS),
      associatedKeys: [OWNER],
      deployedOn: [1n, 10n]
    })
    expect(result.failed).toBe(false)
  })

  test('falls back to the next deployed network when the first one does not include the owner', async () => {
    const mainnetApi = createApi([OTHER_OWNER])
    const optimismApi = createApi()
    const apiKitFactory = jest.fn((chainId: bigint) => (chainId === 1n ? mainnetApi : optimismApi))

    const result = await getSafeAccountByOwner(SAFE_ADDRESS, OWNER, [1n, 10n], apiKitFactory)

    expect(mainnetApi.getSafeInfo).toHaveBeenCalledWith(SAFE_ADDRESS)
    expect(mainnetApi.getSafeCreationInfo).not.toHaveBeenCalled()
    expect(optimismApi.getSafeInfo).toHaveBeenCalledWith(SAFE_ADDRESS)
    expect(optimismApi.getSafeCreationInfo).toHaveBeenCalledWith(SAFE_ADDRESS)
    expect(result.account?.addr).toBe(getAddress(SAFE_ADDRESS))
    expect(result.failed).toBe(false)
  })

  test('does not return an account when no deployed network includes the owner', async () => {
    const api = createApi([OTHER_OWNER])

    const result = await getSafeAccountByOwner(SAFE_ADDRESS, OWNER, [1n, 10n], () => api)

    expect(api.getSafeInfo).toHaveBeenCalledTimes(2)
    expect(api.getSafeCreationInfo).not.toHaveBeenCalled()
    expect(result).toEqual({ account: null, failed: false })
  })
})

describe('normalizeSafeGlobalMessage', () => {
  test('converts a typed message domain chainId bigint to a decimal string', () => {
    const message = {
      types: {
        EIP712Domain: [{ name: 'chainId', type: 'uint256' }],
        Permit: [{ name: 'value', type: 'uint256' }]
      },
      domain: {
        chainId: 1n
      },
      message: {
        value: '133700'
      },
      primaryType: 'Permit'
    }

    const normalizedMessage = normalizeSafeGlobalMessage(message as unknown as EIP712TypedData)
    if (typeof normalizedMessage === 'string') throw new Error('Expected a typed message')

    expect(normalizedMessage.domain.chainId).toBe('1')
  })

  test('does not copy messages without a bigint domain chainId', () => {
    const typedMessage = {
      types: {
        EIP712Domain: [{ name: 'chainId', type: 'uint256' }],
        Permit: [{ name: 'value', type: 'uint256' }]
      },
      domain: {
        chainId: 1
      },
      message: {
        value: '133700'
      },
      primaryType: 'Permit'
    }

    expect(normalizeSafeGlobalMessage('plain message')).toBe('plain message')
    expect(normalizeSafeGlobalMessage(typedMessage)).toBe(typedMessage)
  })
})

describe('buildSafeMessageOrigin', () => {
  test('serializes the dapp name and url', () => {
    expect(buildSafeMessageOrigin({ name: 'Uniswap', url: 'https://app.uniswap.org' })).toBe(
      '{"name":"Uniswap","url":"https://app.uniswap.org"}'
    )
  })

  test('keeps whichever field is present', () => {
    expect(buildSafeMessageOrigin({ name: 'Uniswap' })).toBe('{"name":"Uniswap","url":""}')
    expect(buildSafeMessageOrigin({ url: 'https://app.uniswap.org' })).toBe(
      '{"name":"","url":"https://app.uniswap.org"}'
    )
  })

  test('returns undefined when there is no dapp metadata', () => {
    expect(buildSafeMessageOrigin(null)).toBeUndefined()
    expect(buildSafeMessageOrigin({})).toBeUndefined()
    expect(buildSafeMessageOrigin({ name: '', url: '' })).toBeUndefined()
  })

  test('skips the field rather than exceed the 200 char Safe limit', () => {
    const longUrl = `https://${'a'.repeat(250)}.com`
    expect(buildSafeMessageOrigin({ name: 'Uniswap', url: longUrl })).toBeUndefined()
  })
})

describe('parseSafeMessageOrigin', () => {
  test('parses name and url out of the JSON origin', () => {
    expect(parseSafeMessageOrigin('{"name":"Uniswap","url":"https://app.uniswap.org"}')).toEqual({
      name: 'Uniswap',
      url: 'https://app.uniswap.org'
    })
  })

  test('round-trips with buildSafeMessageOrigin', () => {
    const dapp = { name: 'Uniswap', url: 'https://app.uniswap.org' }
    expect(parseSafeMessageOrigin(buildSafeMessageOrigin(dapp))).toEqual(dapp)
  })

  test('returns empty object when origin is missing', () => {
    expect(parseSafeMessageOrigin()).toEqual({})
    expect(parseSafeMessageOrigin('')).toEqual({})
  })

  test('treats a non-JSON origin as the name (e.g. set by another wallet)', () => {
    expect(parseSafeMessageOrigin('My Custom Safe App')).toEqual({ name: 'My Custom Safe App' })
  })

  test('ignores non-string name/url fields', () => {
    expect(parseSafeMessageOrigin('{"name":123,"url":true}')).toEqual({
      name: undefined,
      url: undefined
    })
  })
})
