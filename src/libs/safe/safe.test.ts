import {
  AbiCoder,
  concat,
  getAddress,
  getBytes,
  getCreate2Address,
  Interface,
  keccak256,
  solidityPacked,
  ZeroAddress
} from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { buildSafeMessageOrigin, parseSafeMessageOrigin } from './helpers'
import {
  findDeployData,
  getSafeAccountByOwner,
  getSafeDeploymentCall,
  hasCompleteSafeCreationData,
  normalizeSafeGlobalMessage,
  toCallsUserRequest
} from './safe'

import type { SafeCreationInfoResponse, SafeInfoResponse } from '@safe-global/api-kit'
import type { EIP712TypedData, SafeMultisigTransactionResponse } from '@safe-global/types-kit'
import type { Hex } from '../../interfaces/hex'
import type { RPCProvider } from '../../interfaces/provider'

const OWNER: Hex = '0xD8293ad21678c6F09Da139b4B62D38e514a03B78'
const OTHER_OWNER = '0x94b0080A00579C1307B0eF2C499AD98A8ce58e58'
const SAFE_ADDRESS: Hex = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

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

describe('Safe deployment data', () => {
  const factoryAddr = '0x1234567890123456789012345678901234567890' as Hex
  const singleton = '0x2345678901234567890123456789012345678901' as Hex
  const setupData = '0x1234' as Hex
  const saltNonce = `0x${'0'.repeat(63)}1` as Hex
  const proxyCreationCode = '0x60006000' as Hex
  const salt = keccak256(concat([keccak256(setupData), saltNonce]))
  const bytecode = concat([proxyCreationCode, new AbiCoder().encode(['address'], [singleton])])
  const safeAddr = getCreate2Address(factoryAddr, salt, keccak256(bytecode))
  const account = {
    addr: safeAddr,
    associatedKeys: [OWNER],
    initialPrivileges: [],
    creation: null,
    safeCreation: { factoryAddr, singleton, setupData, saltNonce, version: '1.4.1' },
    preferences: { label: 'Safe', pfp: safeAddr }
  }
  const encodedProxyCreationCode = new AbiCoder().encode(['bytes'], [proxyCreationCode])
  const deployTransactionData = new Interface([
    'function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce)'
  ]).encodeFunctionData('createProxyWithNonce', [singleton, setupData, saltNonce])
  const deployTransactionHash = `0x${'2'.repeat(64)}` as Hex
  const deploySafeCreationInfo: SafeCreationInfoResponse = {
    ...getSafeCreationInfo(),
    transactionHash: deployTransactionHash,
    factoryAddress: factoryAddr,
    singleton,
    setupData,
    saltNonce: '1'
  }
  const incompleteDeploySafeCreationInfo: SafeCreationInfoResponse = {
    ...deploySafeCreationInfo,
    setupData: '0x',
    saltNonce: null
  }
  const encodedVersion = new AbiCoder().encode(['string'], ['1.4.1'])

  test('returns complete Safe API creation data without fetching the deployment transaction', async () => {
    const getSafeCreationInfo = jest.fn(async () => deploySafeCreationInfo)
    const provider = {
      getTransaction: jest.fn(),
      call: jest.fn(async () => encodedVersion)
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toEqual({
      factoryAddr: getAddress(factoryAddr),
      singleton: getAddress(singleton),
      setupData,
      saltNonce,
      version: '1.4.1'
    })
    expect(getSafeCreationInfo).toHaveBeenCalledWith(safeAddr)
    expect(provider.getTransaction).not.toHaveBeenCalled()
  })

  test('recovers and validates missing Safe deployment data from the indexed transaction', async () => {
    const getSafeCreationInfo = jest.fn(async () => incompleteDeploySafeCreationInfo)
    const provider = {
      getTransaction: jest.fn(async () => ({
        to: factoryAddr,
        data: deployTransactionData
      })),
      call: jest
        .fn()
        .mockResolvedValueOnce(encodedVersion)
        .mockResolvedValueOnce(encodedProxyCreationCode)
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toEqual({
      factoryAddr: getAddress(factoryAddr),
      singleton: getAddress(singleton),
      setupData,
      saltNonce,
      version: '1.4.1'
    })
    expect(provider.getTransaction).toHaveBeenCalledWith(deployTransactionHash)
  })

  test('recovers deployment data when the factory call is nested in other calldata', async () => {
    const getSafeCreationInfo = jest.fn(async () => incompleteDeploySafeCreationInfo)
    const nestedTransactionData = new Interface([
      'function execute(bytes data)'
    ]).encodeFunctionData('execute', [deployTransactionData])
    const provider = {
      getTransaction: jest.fn(async () => ({
        to: OTHER_OWNER,
        data: nestedTransactionData
      })),
      call: jest
        .fn()
        .mockResolvedValueOnce(encodedVersion)
        .mockResolvedValueOnce(encodedProxyCreationCode)
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toMatchObject({
      factoryAddr: getAddress(factoryAddr),
      singleton: getAddress(singleton),
      setupData,
      saltNonce
    })
  })

  test('recovers a missing factory address from a direct deployment transaction', async () => {
    const getSafeCreationInfo = jest.fn(async () => ({
      ...incompleteDeploySafeCreationInfo,
      factoryAddress: '0x'
    }))
    const provider = {
      getTransaction: jest.fn(async () => ({
        to: factoryAddr,
        data: deployTransactionData
      })),
      call: jest
        .fn()
        .mockResolvedValueOnce(encodedVersion)
        .mockResolvedValueOnce(encodedProxyCreationCode)
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toEqual(account.safeCreation)
  })

  test('returns partial API data when the creation record has no deployment transaction', async () => {
    const creationInfo = { ...incompleteDeploySafeCreationInfo, transactionHash: '' }
    const getSafeCreationInfo = jest.fn(async () => creationInfo)
    const provider = {
      getTransaction: jest.fn(),
      call: jest.fn(async () => encodedVersion)
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toEqual({
      factoryAddr,
      singleton,
      setupData: '0x',
      saltNonce: '0x',
      version: '1.4.1'
    })
    expect(provider.getTransaction).not.toHaveBeenCalled()
  })

  test('returns partial API data when the indexed deployment transaction is unavailable', async () => {
    const getSafeCreationInfo = jest.fn(async () => incompleteDeploySafeCreationInfo)
    const provider = {
      getTransaction: jest.fn(async () => null),
      call: jest.fn(async () => encodedVersion)
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toMatchObject({ setupData: '0x', saltNonce: '0x', version: '1.4.1' })
  })

  test('returns partial API data when the indexed transaction does not include a deployment', async () => {
    const getSafeCreationInfo = jest.fn(async () => incompleteDeploySafeCreationInfo)
    const provider = {
      getTransaction: jest.fn(async () => ({ to: factoryAddr, data: '0x1234' })),
      call: jest.fn(async () => encodedVersion)
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toMatchObject({ setupData: '0x', saltNonce: '0x', version: '1.4.1' })
  })

  test('does not replace partial API data with deployment data for a different Safe address', async () => {
    const getSafeCreationInfo = jest.fn(async () => incompleteDeploySafeCreationInfo)
    const provider = {
      getTransaction: jest.fn(async () => ({
        to: factoryAddr,
        data: deployTransactionData
      })),
      call: jest
        .fn()
        .mockResolvedValueOnce(encodedVersion)
        .mockResolvedValueOnce(encodedProxyCreationCode)
    } as unknown as RPCProvider

    await expect(
      findDeployData(OTHER_OWNER, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toMatchObject({ setupData: '0x', saltNonce: '0x', version: '1.4.1' })
  })

  test('returns all-empty creation data when the Safe API request fails', async () => {
    const getSafeCreationInfo = jest.fn(async () => {
      throw new Error('Safe API unavailable')
    })
    const provider = {} as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toEqual({
      factoryAddr: '0x',
      singleton: '0x',
      setupData: '0x',
      saltNonce: '0x',
      version: ''
    })
  })

  test('treats a missing version or deployment field as incomplete creation data', () => {
    expect(hasCompleteSafeCreationData(account.safeCreation)).toBe(true)
    expect(hasCompleteSafeCreationData({ ...account.safeCreation, version: '' })).toBe(false)
    expect(hasCompleteSafeCreationData({ ...account.safeCreation, setupData: '0x' })).toBe(false)
    expect(hasCompleteSafeCreationData(undefined)).toBe(false)
  })

  test('builds the factory call when the saved creation data derives the account address', async () => {
    const provider = {
      call: jest.fn(async () => encodedProxyCreationCode),
      getCode: jest.fn(async () => '0x6000')
    } as unknown as RPCProvider

    const call = await getSafeDeploymentCall(account, provider)

    expect(call).toEqual({
      to: factoryAddr,
      value: 0n,
      data: new Interface([
        'function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce)'
      ]).encodeFunctionData('createProxyWithNonce', [singleton, setupData, saltNonce])
    })
  })

  test('returns null when the singleton is not deployed on the network', async () => {
    const provider = {
      call: jest.fn(async () => encodedProxyCreationCode),
      getCode: jest.fn(async () => '0x')
    } as unknown as RPCProvider

    await expect(getSafeDeploymentCall(account, provider)).resolves.toBeNull()
    expect(provider.getCode).toHaveBeenCalledWith(singleton)
  })

  test('returns null when the singleton deployment cannot be checked', async () => {
    const provider = {
      call: jest.fn(async () => encodedProxyCreationCode),
      getCode: jest.fn(async () => {
        throw new Error('singleton unavailable')
      })
    } as unknown as RPCProvider

    await expect(getSafeDeploymentCall(account, provider)).resolves.toBeNull()
  })

  test('rejects saved creation data that derives a different account address', async () => {
    const provider = {
      call: jest.fn(async () => encodedProxyCreationCode)
    } as unknown as RPCProvider

    await expect(
      getSafeDeploymentCall({ ...account, addr: OTHER_OWNER }, provider)
    ).resolves.toBeNull()
  })

  test('returns null when the factory deployment data cannot be read on the network', async () => {
    const provider = {
      call: jest.fn(async () => {
        throw new Error('factory unavailable')
      })
    } as unknown as RPCProvider

    await expect(getSafeDeploymentCall(account, provider)).resolves.toBeNull()
  })

  test('returns null when the saved creation data is malformed', async () => {
    const provider = {
      call: jest.fn(async () => encodedProxyCreationCode)
    } as unknown as RPCProvider

    await expect(
      getSafeDeploymentCall(
        {
          ...account,
          safeCreation: { ...account.safeCreation, setupData: 'invalid-data' as Hex }
        },
        provider
      )
    ).resolves.toBeNull()
  })
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
