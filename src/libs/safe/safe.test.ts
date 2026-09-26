import { concat, getAddress, getBytes, Interface, solidityPacked, ZeroAddress } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'
import SafeApiKit from '@safe-global/api-kit'

import {
  buildSafeMessageOrigin,
  buildSafeTransactionOrigin,
  parseSafeMessageOrigin,
  parseSafeTransactionOrigin
} from './helpers'
import {
  getSafeAccountByOwner,
  normalizeSafeGlobalMessage,
  propose,
  toCallsUserRequest
} from './safe'

import type { SafeCreationInfoResponse, SafeInfoResponse } from '@safe-global/api-kit'
import type { EIP712TypedData, SafeMultisigTransactionResponse } from '@safe-global/types-kit'
import type { Dapp } from '../../interfaces/dapp'
import type { Hex } from '../../interfaces/hex'
import type { SafeTx } from '../../interfaces/safe'

const OWNER: Hex = '0xD8293ad21678c6F09Da139b4B62D38e514a03B78'
const OTHER_OWNER = '0x94b0080A00579C1307B0eF2C499AD98A8ce58e58'
const SAFE_ADDRESS: Hex = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const UNISWAP_DAPP: Dapp = {
  id: 'uniswap',
  name: 'Uniswap',
  description: '',
  url: 'https://app.uniswap.org',
  icon: 'https://example.com/uniswap.png'
}
const AAVE_DAPP: Dapp = {
  id: 'aave',
  name: 'Aave',
  description: '',
  url: 'https://app.aave.com',
  icon: 'https://example.com/aave.png'
}

const buildSafeTransaction = (
  overrides: Partial<SafeMultisigTransactionResponse>
): SafeMultisigTransactionResponse => ({
  safe: SAFE_ADDRESS,
  to: ZeroAddress,
  value: '0',
  data: '0x',
  operation: 0,
  gasToken: ZeroAddress,
  safeTxGas: '0',
  baseGas: '0',
  gasPrice: '0',
  nonce: '7',
  executionDate: null,
  submissionDate: '2026-08-14T00:00:00Z',
  modified: '2026-08-14T00:00:00Z',
  blockNumber: null,
  transactionHash: null,
  safeTxHash: `0x${'1'.repeat(64)}`,
  executor: null,
  proposer: null,
  proposedByDelegate: null,
  isExecuted: false,
  isSuccessful: null,
  ethGasPrice: null,
  maxFeePerGas: null,
  maxPriorityFeePerGas: null,
  gasUsed: null,
  fee: null,
  origin: '',
  confirmationsRequired: 2,
  confirmations: [],
  trusted: true,
  signatures: null,
  ...overrides
})

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

describe('toCallsUserRequest', () => {
  test('decodes a batch call from multiSend data', () => {
    const calls = [{ to: ZeroAddress, value: 0n, data: '0x' }]
    const encodedCalls = concat(
      calls.map((call) =>
        solidityPacked(
          ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
          [0, call.to, call.value, BigInt(getBytes(call.data).length), call.data]
        )
      )
    )
    const data = new Interface(['function multiSend(bytes transactions)']).encodeFunctionData(
      'multiSend',
      [encodedCalls]
    )

    const { calls: decodedCalls } = toCallsUserRequest(SAFE_ADDRESS, {
      '1': { txns: [buildSafeTransaction({ data })], messages: [] }
    })[0]!.params.userRequestParams

    expect(decodedCalls).toEqual(calls)
  })

  test('restores dapp metadata on the matching decoded batch calls', () => {
    const calls = [
      { to: ZeroAddress, value: 0n, data: '0x', dapp: UNISWAP_DAPP },
      { to: OWNER, value: 1n, data: '0x', dapp: AAVE_DAPP }
    ]
    const encodedCalls = concat(
      calls.map((call) =>
        solidityPacked(
          ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
          [0, call.to, call.value, BigInt(getBytes(call.data).length), call.data]
        )
      )
    )
    const data = new Interface(['function multiSend(bytes transactions)']).encodeFunctionData(
      'multiSend',
      [encodedCalls]
    )
    const origin = buildSafeTransactionOrigin(calls)
    const dappsById = new Map([
      [UNISWAP_DAPP.id, UNISWAP_DAPP],
      [AAVE_DAPP.id, AAVE_DAPP]
    ])

    const { calls: decodedCalls } = toCallsUserRequest(
      SAFE_ADDRESS,
      {
        '1': { txns: [buildSafeTransaction({ data, origin })], messages: [] }
      },
      (id) => dappsById.get(id)
    )[0]!.params.userRequestParams

    expect(decodedCalls).toEqual([calls[0], { ...calls[1], to: calls[1]!.to.toLowerCase() }])
  })

  test('does not attach metadata when the reported dapp is not in the catalogue', () => {
    const origin = buildSafeTransactionOrigin([
      { to: ZeroAddress, value: 0n, data: '0x', dapp: UNISWAP_DAPP }
    ])

    const { calls } = toCallsUserRequest(
      SAFE_ADDRESS,
      {
        '1': { txns: [buildSafeTransaction({ origin })], messages: [] }
      },
      () => undefined
    )[0]!.params.userRequestParams

    expect(calls).toEqual([{ to: ZeroAddress, value: 0n, data: '0x' }])
  })
})

describe('Safe transaction origin', () => {
  test('groups call indexes by dapp ID and round-trips them', () => {
    const origin = buildSafeTransactionOrigin([
      { to: ZeroAddress, value: 0n, data: '0x', dapp: UNISWAP_DAPP },
      { to: ZeroAddress, value: 0n, data: '0x', dapp: AAVE_DAPP },
      { to: ZeroAddress, value: 0n, data: '0x', dapp: UNISWAP_DAPP },
      { to: ZeroAddress, value: 0n, data: '0x' }
    ])

    expect(origin).toBe('{"name":"Ambire","v":1,"calls":[["uniswap",[0,2]],["aave",[1]]]}')
    expect(Array.from(parseSafeTransactionOrigin(origin).entries())).toEqual([
      [0, 'uniswap'],
      [2, 'uniswap'],
      [1, 'aave']
    ])
  })

  test('returns no origin without dapp metadata or when the payload exceeds Safe limits', () => {
    expect(buildSafeTransactionOrigin([{ to: ZeroAddress, value: 0n, data: '0x' }])).toBeUndefined()
    expect(
      buildSafeTransactionOrigin([
        {
          to: ZeroAddress,
          value: 0n,
          data: '0x',
          dapp: { ...UNISWAP_DAPP, id: 'x'.repeat(200) }
        }
      ])
    ).toBeUndefined()
  })

  test.each([
    undefined,
    '',
    'Ambire',
    '{}',
    '{"name":"Other","v":1,"calls":[["uniswap",[0]]]}',
    '{"name":"Ambire","v":2,"calls":[["uniswap",[0]]]}',
    '{"name":"Ambire","v":1,"calls":[["uniswap",[-1,1.5,"2"]]]}'
  ])('ignores invalid or foreign origin payload %p', (origin) => {
    expect(Array.from(parseSafeTransactionOrigin(origin).entries())).toEqual([])
  })
})

describe('propose', () => {
  test('forwards the origin to the Safe API', async () => {
    const previousApiKey = process.env.SAFE_API_KEY
    process.env.SAFE_API_KEY = 'test-safe-api-key'
    const proposeTransactionSpy = jest
      .spyOn(SafeApiKit.prototype, 'proposeTransaction')
      .mockResolvedValue()
    const txn: SafeTx = {
      to: ZeroAddress as `0x${string}`,
      value: '0x00',
      data: '0x',
      operation: 0,
      safeTxGas: '0x00',
      baseGas: '0x00',
      gasPrice: '0x00',
      gasToken: ZeroAddress as `0x${string}`,
      refundReceiver: ZeroAddress as `0x${string}`,
      nonce: '0x00'
    }
    const origin = '{"name":"Ambire","v":1,"calls":[["uniswap",[0]]]}'

    try {
      await propose(txn, 1n, SAFE_ADDRESS, OWNER, '0x1234', `0x${'1'.repeat(64)}`, origin)

      expect(proposeTransactionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          origin
        })
      )
    } finally {
      proposeTransactionSpy.mockRestore()
      if (previousApiKey === undefined) delete process.env.SAFE_API_KEY
      else process.env.SAFE_API_KEY = previousApiKey
    }
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
