import {
  AbiCoder,
  concat,
  getAddress,
  getBytes,
  getCreate2Address,
  hashMessage,
  id,
  Interface,
  keccak256,
  makeError,
  Signature,
  solidityPacked,
  toUtf8Bytes,
  TypedDataEncoder,
  Wallet,
  ZeroAddress,
  zeroPadValue
} from 'ethers'

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import SafeApiKit from '@safe-global/api-kit'

import { suppressConsole } from '../../../test/helpers/console'
import {
  multiSendAddr,
  SAFE_API_TIMEOUT_MS,
  SAFE_SENTINEL_OWNER,
  SAFE_V1_4_1
} from '../../consts/safe'
import {
  getEIP712Hash,
  getSafeTypedData,
  getSafeTypedDataForIsValidSignature,
  getSafeV1TypedData
} from '../signMessage/signMessage'
import {
  buildSafeMessageOrigin,
  doCallsMatchSafeTx,
  getSafeTxCalls,
  parseSafeMessageOrigin,
  toSafeTx
} from './helpers'
import {
  canHotOwnersMeetSafeThreshold,
  decodeSetupData,
  fetchExecutedTransactions,
  findDeployData,
  getAlreadySignedOwners,
  getLatestMessages,
  getMessage,
  getNewSafeAccount,
  getNewSafeCreation,
  getPendingTransactions,
  getSafeAccountByOwner,
  getSafeApprovedHashSignature,
  getSafeApproveHashCall,
  getSafeDeploymentCall,
  getSafeProxyAddress,
  getSafeTxnHash,
  getSigs,
  getVerifiedSafeConfirmations,
  hasCompleteSafeCreationData,
  isSafeContract,
  isSafeHashApproved,
  isSafeMessageHashValid,
  isSafeTxHashValid,
  normalizeSafeGlobalMessage,
  sortSigs,
  toCallsUserRequest
} from './safe'

import type {
  SafeCreationInfoResponse,
  SafeInfoResponse,
  SafeMultisigTransactionListResponse
} from '@safe-global/api-kit'
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
  getSafeCreationInfo: jest.fn<SafeApiKit['getSafeCreationInfo']>(async () =>
    getSafeCreationInfo()
  ),
  getSafeInfo: jest.fn<SafeApiKit['getSafeInfo']>(async () => getSafeInfo(owners))
})

describe('isSafeContract', () => {
  const getThresholdData = new Interface([
    'function getThreshold() view returns (uint256)'
  ]).encodeFunctionData('getThreshold')
  const createProvider = (call: () => Promise<string>) =>
    ({ call: jest.fn(call) }) as unknown as RPCProvider

  test('returns true when the contract answers getThreshold()', async () => {
    const provider = createProvider(async () => new AbiCoder().encode(['uint256'], [2]))

    await expect(isSafeContract(SAFE_ADDRESS, provider)).resolves.toBe(true)
    expect(provider.call).toHaveBeenCalledWith(expect.objectContaining({ data: getThresholdData }))
  })

  test('returns false when the contract has no getThreshold() and returns no data', async () => {
    // e.g. an older Gnosis MultiSigWallet, whose fallback accepts any call and returns nothing
    const provider = createProvider(async () => '0x')

    await expect(isSafeContract(SAFE_ADDRESS, provider)).resolves.toBe(false)
  })

  test('returns false when the getThreshold() call reverts', async () => {
    const provider = createProvider(async () => {
      throw makeError('execution reverted', 'CALL_EXCEPTION', {
        action: 'call',
        data: '0x',
        reason: null,
        transaction: { to: SAFE_ADDRESS, data: getThresholdData },
        invocation: null,
        revert: null
      })
    })

    await expect(isSafeContract(SAFE_ADDRESS, provider)).resolves.toBe(false)
  })

  test('throws when the network request fails, instead of claiming it is not a Safe', async () => {
    const networkError = new Error('fetch failed')
    const provider = createProvider(async () => {
      throw networkError
    })

    await expect(isSafeContract(SAFE_ADDRESS, provider)).rejects.toBe(networkError)
  })
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
    safeCreation: { factoryAddr, singleton, setupData, saltNonce },
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

  test('returns complete Safe API creation data without fetching the deployment transaction', async () => {
    const getSafeCreationInfo = jest.fn<SafeApiKit['getSafeCreationInfo']>(
      async () => deploySafeCreationInfo
    )
    const provider = {
      getTransaction: jest.fn(),
      call: jest.fn()
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toEqual({
      factoryAddr: getAddress(factoryAddr),
      singleton: getAddress(singleton),
      setupData,
      saltNonce
    })
    expect(getSafeCreationInfo).toHaveBeenCalledWith(safeAddr)
    expect(provider.getTransaction).not.toHaveBeenCalled()
    // the Safe version is chain specific and comes from the account state, not the creation data
    expect(provider.call).not.toHaveBeenCalled()
  })

  test('recovers and validates missing Safe deployment data from the indexed transaction', async () => {
    const getSafeCreationInfo = jest.fn(async () => incompleteDeploySafeCreationInfo)
    const provider = {
      getTransaction: jest.fn(async () => ({
        to: factoryAddr,
        data: deployTransactionData
      })),
      call: jest.fn(async () => encodedProxyCreationCode)
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toEqual({
      factoryAddr: getAddress(factoryAddr),
      singleton: getAddress(singleton),
      setupData,
      saltNonce
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
      call: jest.fn(async () => encodedProxyCreationCode)
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
      call: jest.fn(async () => encodedProxyCreationCode)
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toEqual(account.safeCreation)
  })

  describe('when the Safe API does not know the factory', () => {
    const entryPointAddr = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Hex
    const fakeFactoryAddr = '0x3456789012345678901234567890123456789012' as Hex
    const proxyCreationTopic = id('ProxyCreation(address,address)')
    const paddedSafeAddr = zeroPadValue(safeAddr, 32)
    const factoryLessCreationInfo: SafeCreationInfoResponse = {
      ...incompleteDeploySafeCreationInfo,
      factoryAddress: '0x'
    }
    const unrecoveredCreation = {
      factoryAddr: '0x',
      singleton: getAddress(singleton),
      setupData: '0x',
      saltNonce: '0x'
    }
    // 4337 deployments: the EntryPoint is called and the factory call is packed in the initCode
    const handleOpsData = new Interface(['function handleOps(bytes initCode)']).encodeFunctionData(
      'handleOps',
      [concat([factoryAddr, deployTransactionData])]
    )
    const proxyCreationLogV141 = {
      address: factoryAddr,
      topics: [proxyCreationTopic, paddedSafeAddr],
      data: new AbiCoder().encode(['address'], [singleton])
    }
    const proxyCreationLogV130 = {
      address: factoryAddr,
      topics: [proxyCreationTopic],
      data: new AbiCoder().encode(['address', 'address'], [safeAddr, singleton])
    }

    const buildProvider = ({
      to = entryPointAddr,
      data = handleOpsData,
      getTransactionReceipt = jest.fn(
        async (): Promise<unknown> => ({
          logs: [proxyCreationLogV141]
        })
      )
    }: {
      to?: Hex
      data?: string
      getTransactionReceipt?: jest.Mock<() => Promise<unknown>>
    } = {}) =>
      ({
        getTransaction: jest.fn(async () => ({ hash: deployTransactionHash, to, data })),
        getTransactionReceipt,
        call: jest.fn(async () => encodedProxyCreationCode)
      }) as unknown as RPCProvider

    const findFactoryLessDeployData = (provider: RPCProvider) =>
      findDeployData(safeAddr, 1n, provider, () => ({
        getSafeCreationInfo: jest.fn(async () => factoryLessCreationInfo)
      }))

    test('recovers the factory from a v1.4.1+ deploy log when the deployment is wrapped', async () => {
      const provider = buildProvider()

      await expect(findFactoryLessDeployData(provider)).resolves.toEqual(account.safeCreation)
      expect(provider.getTransactionReceipt).toHaveBeenCalledWith(deployTransactionHash)
    })

    test('recovers the factory from a v1.3.0 deploy log when the deployment is wrapped', async () => {
      const provider = buildProvider({
        getTransactionReceipt: jest.fn(
          async (): Promise<unknown> => ({
            logs: [proxyCreationLogV130]
          })
        )
      })

      await expect(findFactoryLessDeployData(provider)).resolves.toEqual(account.safeCreation)
    })

    test('does not fetch the receipt when the factory is called directly', async () => {
      const provider = buildProvider({ to: factoryAddr, data: deployTransactionData })

      await expect(findFactoryLessDeployData(provider)).resolves.toEqual(account.safeCreation)
      expect(provider.getTransactionReceipt).not.toHaveBeenCalled()
    })

    test('recovers a direct createProxyWithNonceL2 deployment', async () => {
      const deployL2TransactionData = new Interface([
        'function createProxyWithNonceL2(address _singleton, bytes initializer, uint256 saltNonce)'
      ]).encodeFunctionData('createProxyWithNonceL2', [singleton, setupData, saltNonce])
      const provider = buildProvider({ to: factoryAddr, data: deployL2TransactionData })

      await expect(findFactoryLessDeployData(provider)).resolves.toEqual(account.safeCreation)
      expect(provider.getTransactionReceipt).not.toHaveBeenCalled()
    })

    test('recovers a wrapped createProxyWithNonceL2 deployment', async () => {
      const deployL2TransactionData = new Interface([
        'function createProxyWithNonceL2(address _singleton, bytes initializer, uint256 saltNonce)'
      ]).encodeFunctionData('createProxyWithNonceL2', [singleton, setupData, saltNonce])
      const provider = buildProvider({
        data: new Interface(['function handleOps(bytes initCode)']).encodeFunctionData(
          'handleOps',
          [concat([factoryAddr, deployL2TransactionData])]
        )
      })

      await expect(findFactoryLessDeployData(provider)).resolves.toEqual(account.safeCreation)
    })

    test('does not recover a chain specific deployment as it cannot be replayed on other chains', async () => {
      const chainSpecificDeployData = new Interface([
        'function createChainSpecificProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce)'
      ]).encodeFunctionData('createChainSpecificProxyWithNonce', [singleton, setupData, saltNonce])
      const provider = buildProvider({ to: factoryAddr, data: chainSpecificDeployData })

      await expect(findFactoryLessDeployData(provider)).resolves.toEqual(unrecoveredCreation)
    })

    test('returns partial API data when the deploy receipt cannot be fetched', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const provider = buildProvider({
        getTransactionReceipt: jest.fn(async (): Promise<unknown> => {
          throw new Error('RPC unavailable')
        })
      })

      await expect(findFactoryLessDeployData(provider)).resolves.toEqual(unrecoveredCreation)
      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })

    test('returns partial API data when the deploy receipt is missing', async () => {
      const provider = buildProvider({
        getTransactionReceipt: jest.fn(async (): Promise<unknown> => null)
      })

      await expect(findFactoryLessDeployData(provider)).resolves.toEqual(unrecoveredCreation)
    })

    test('ignores deploy logs for a different Safe', async () => {
      const provider = buildProvider({
        getTransactionReceipt: jest.fn(
          async (): Promise<unknown> => ({
            logs: [
              {
                ...proxyCreationLogV141,
                topics: [proxyCreationTopic, zeroPadValue(OTHER_OWNER, 32)]
              }
            ]
          })
        )
      })

      await expect(findFactoryLessDeployData(provider)).resolves.toEqual(unrecoveredCreation)
    })

    test('ignores unrelated logs that mention the Safe', async () => {
      const provider = buildProvider({
        getTransactionReceipt: jest.fn(
          async (): Promise<unknown> => ({
            logs: [
              {
                ...proxyCreationLogV141,
                topics: [id('Transfer(address,address,uint256)'), paddedSafeAddr]
              }
            ]
          })
        )
      })

      await expect(findFactoryLessDeployData(provider)).resolves.toEqual(unrecoveredCreation)
    })

    test('rejects a spoofed deploy log emitted by a contract that is not the real factory', async () => {
      const provider = buildProvider({
        getTransactionReceipt: jest.fn(
          async (): Promise<unknown> => ({
            logs: [{ ...proxyCreationLogV141, address: fakeFactoryAddr }]
          })
        )
      })

      await expect(findFactoryLessDeployData(provider)).resolves.toEqual(unrecoveredCreation)
    })
  })

  test('returns partial API data when the creation record has no deployment transaction', async () => {
    const creationInfo = { ...incompleteDeploySafeCreationInfo, transactionHash: '' }
    const getSafeCreationInfo = jest.fn(async () => creationInfo)
    const provider = {
      getTransaction: jest.fn(),
      call: jest.fn()
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toEqual({
      factoryAddr,
      singleton,
      setupData: '0x',
      saltNonce: '0x'
    })
    expect(provider.getTransaction).not.toHaveBeenCalled()
  })

  test('returns partial API data when the indexed deployment transaction is unavailable', async () => {
    const getSafeCreationInfo = jest.fn(async () => incompleteDeploySafeCreationInfo)
    const provider = {
      getTransaction: jest.fn(async () => null),
      call: jest.fn()
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toMatchObject({ setupData: '0x', saltNonce: '0x' })
  })

  test('returns partial API data when the indexed transaction does not include a deployment', async () => {
    const getSafeCreationInfo = jest.fn(async () => incompleteDeploySafeCreationInfo)
    const provider = {
      getTransaction: jest.fn(async () => ({ to: factoryAddr, data: '0x1234' })),
      call: jest.fn()
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toMatchObject({ setupData: '0x', saltNonce: '0x' })
  })

  test('does not replace partial API data with deployment data for a different Safe address', async () => {
    const getSafeCreationInfo = jest.fn(async () => incompleteDeploySafeCreationInfo)
    const provider = {
      getTransaction: jest.fn(async () => ({
        to: factoryAddr,
        data: deployTransactionData
      })),
      call: jest.fn(async () => encodedProxyCreationCode)
    } as unknown as RPCProvider

    await expect(
      findDeployData(OTHER_OWNER, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toMatchObject({ setupData: '0x', saltNonce: '0x' })
  })

  test('returns the error when the Safe API request fails', async () => {
    const apiError = new Error('Safe API unavailable')
    const getSafeCreationInfo = jest.fn(async () => {
      throw apiError
    })
    const provider = {
      getTransaction: jest.fn()
    } as unknown as RPCProvider

    await expect(
      findDeployData(safeAddr, 1n, provider, () => ({ getSafeCreationInfo }))
    ).resolves.toBe(apiError)
    expect(provider.getTransaction).not.toHaveBeenCalled()
  })

  test('treats a missing deployment field as incomplete creation data', () => {
    expect(hasCompleteSafeCreationData(account.safeCreation)).toBe(true)
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
    const { restore } = suppressConsole()
    const provider = {
      call: jest.fn(async () => encodedProxyCreationCode),
      getCode: jest.fn(async () => {
        throw new Error('singleton unavailable')
      })
    } as unknown as RPCProvider

    await expect(getSafeDeploymentCall(account, provider)).resolves.toBeNull()
    restore()
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
    const { restore } = suppressConsole()
    const provider = {
      call: jest.fn(async () => {
        throw new Error('factory unavailable')
      })
    } as unknown as RPCProvider

    await expect(getSafeDeploymentCall(account, provider)).resolves.toBeNull()
    restore()
  })

  test('returns null when the saved creation data is malformed', async () => {
    const { restore } = suppressConsole()
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
    restore()
  })

  describe('the fallback handler of a new Safe', () => {
    // Checksummed from lowercase, as getNewSafeAccount rejects an address with a wrong checksum
    const ownerA = getAddress(OWNER.toLowerCase()) as Hex
    const ownerB = getAddress(OTHER_OWNER.toLowerCase()) as Hex
    const newSafeAccount = getNewSafeAccount([ownerA, ownerB], 2, [])
    const encodedV141ProxyCreationCode = new AbiCoder().encode(
      ['bytes'],
      [SAFE_V1_4_1.proxyCreationCode]
    )
    const getProvider = (missingContract?: string) =>
      ({
        call: jest.fn(async () => encodedV141ProxyCreationCode),
        getCode: jest.fn(async (address: string) =>
          address.toLowerCase() === missingContract?.toLowerCase() ? '0x' : '0x6000'
        )
      }) as unknown as RPCProvider

    test('builds the factory call when the singleton and the fallback handler are deployed', async () => {
      const provider = getProvider()

      await expect(getSafeDeploymentCall(newSafeAccount, provider)).resolves.toMatchObject({
        to: SAFE_V1_4_1.proxyFactory
      })
      expect(provider.getCode).toHaveBeenCalledWith(SAFE_V1_4_1.compatibilityFallbackHandler)
    })

    test('returns null when the fallback handler is not deployed on the network', async () => {
      const provider = getProvider(SAFE_V1_4_1.compatibilityFallbackHandler)

      await expect(getSafeDeploymentCall(newSafeAccount, provider)).resolves.toBeNull()
    })

    test('returns null when the singleton is not deployed, even with the fallback handler', async () => {
      const provider = getProvider(SAFE_V1_4_1.singletonL2)

      await expect(getSafeDeploymentCall(newSafeAccount, provider)).resolves.toBeNull()
    })

    test('does not check a fallback handler for a Safe set up without one', async () => {
      const setupWithoutFallbackHandler = new Interface([
        'function setup(address[] _owners,uint256 _threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)'
      ]).encodeFunctionData('setup', [
        [ownerA],
        1,
        ZeroAddress,
        '0x',
        ZeroAddress,
        ZeroAddress,
        0,
        ZeroAddress
      ]) as Hex
      const safeCreation = {
        ...newSafeAccount.safeCreation!,
        setupData: setupWithoutFallbackHandler
      }
      const safeWithoutFallbackHandler = {
        ...newSafeAccount,
        addr: getSafeProxyAddress(safeCreation, SAFE_V1_4_1.proxyCreationCode),
        safeCreation
      }
      const provider = getProvider()

      await expect(
        getSafeDeploymentCall(safeWithoutFallbackHandler, provider)
      ).resolves.not.toBeNull()
      expect(provider.getCode).toHaveBeenCalledTimes(1)
      expect(provider.getCode).toHaveBeenCalledWith(SAFE_V1_4_1.singletonL2)
    })
  })
})

describe('toCallsUserRequest', () => {
  const RECIPIENT = '0x1111111111111111111111111111111111111111'
  const OTHER_RECIPIENT = '0x2222222222222222222222222222222222222222'
  const UNKNOWN_CONTRACT = '0x9999999999999999999999999999999999999999'
  const batchCalls = [
    { to: RECIPIENT, value: 1n, data: '0x' },
    { to: OTHER_RECIPIENT, value: 0n, data: '0x12345678' }
  ]
  const encodeMultiSend = (
    calls: { to: string; value: bigint; data: string; operation?: number }[],
    suffix = '0x'
  ) =>
    new Interface(['function multiSend(bytes transactions)']).encodeFunctionData('multiSend', [
      concat([
        ...calls.map((call) =>
          solidityPacked(
            ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
            [
              call.operation ?? 0,
              call.to,
              call.value,
              BigInt(getBytes(call.data).length),
              call.data
            ]
          )
        ),
        suffix
      ])
    ])
  const getCalls = (overrides: Partial<SafeMultisigTransactionResponse>) =>
    toCallsUserRequest(SAFE_ADDRESS, {
      '1': { txns: [buildSafeTransaction(overrides)], messages: [] }
    })[0]!.params.userRequestParams.calls

  test('decodes a batch delegated to a known multiSend contract', () => {
    const calls = getCalls({
      to: multiSendAddr,
      operation: 1,
      data: encodeMultiSend(batchCalls)
    })

    expect(calls).toEqual(batchCalls)
  })

  test('decodes a batch whose data is not padded to a full word at its end', () => {
    // some apps leave out the zeros that pad the batch to a full 32-byte word, and the multiSend
    // contract still runs it
    const data = encodeMultiSend(batchCalls).slice(0, -8)

    expect(getCalls({ to: multiSendAddr, operation: 1, data })).toEqual(batchCalls)
  })

  test('shows a plain call with multiSend data as it will be sent, with its value', () => {
    // A plain call runs the target itself, not the calls in its data
    const data = encodeMultiSend(batchCalls)
    const calls = getCalls({ to: UNKNOWN_CONTRACT, operation: 0, value: '5', data })

    expect(calls).toEqual([{ to: UNKNOWN_CONTRACT, value: 5n, data }])
  })

  test('shows a batch delegated to an unknown contract as it will be sent', () => {
    const data = encodeMultiSend(batchCalls)

    expect(getCalls({ to: UNKNOWN_CONTRACT, operation: 1, data })).toEqual([
      { to: UNKNOWN_CONTRACT, value: 0n, data }
    ])
  })

  test('shows a batch with a value as it will be sent', () => {
    const data = encodeMultiSend(batchCalls)

    expect(getCalls({ to: multiSendAddr, operation: 1, value: '1', data })).toEqual([
      { to: multiSendAddr, value: 1n, data }
    ])
  })

  test('shows a batch with a delegate call in it as it will be sent', () => {
    const data = encodeMultiSend([batchCalls[0]!, { ...batchCalls[1]!, operation: 1 }])

    expect(getCalls({ to: multiSendAddr, operation: 1, data })).toEqual([
      { to: multiSendAddr, value: 0n, data }
    ])
  })

  test('shows a batch with bytes left after its calls as it will be sent', () => {
    const data = encodeMultiSend(batchCalls, '0x00')

    expect(getCalls({ to: multiSendAddr, operation: 1, data })).toEqual([
      { to: multiSendAddr, value: 0n, data }
    ])
  })
})

describe('doCallsMatchSafeTx', () => {
  const RECIPIENT = '0x1111111111111111111111111111111111111111'
  const safeTx = buildSafeTransaction({ to: RECIPIENT, value: '7', data: '0xabcdef', operation: 0 })

  test('matches a single call with the same target, value and data', () => {
    expect(doCallsMatchSafeTx([{ to: RECIPIENT, value: 7n, data: '0xABCDEF' }], safeTx)).toBe(true)
  })

  test('does not match a call with another value or target', () => {
    expect(doCallsMatchSafeTx([{ to: RECIPIENT, value: 0n, data: '0xabcdef' }], safeTx)).toBe(false)
    expect(doCallsMatchSafeTx([{ to: OWNER, value: 7n, data: '0xabcdef' }], safeTx)).toBe(false)
  })

  test('never matches a delegate call that is not a known multiSend batch', () => {
    const delegateCall = { ...safeTx, operation: 1 }

    expect(doCallsMatchSafeTx([{ to: RECIPIENT, value: 7n, data: '0xabcdef' }], delegateCall)).toBe(
      false
    )
    expect(getSafeTxCalls(delegateCall)).toEqual([{ to: RECIPIENT, value: 7n, data: '0xabcdef' }])
  })
})

describe('isSafeTxHashValid', () => {
  const RECIPIENT = '0x1111111111111111111111111111111111111111'
  const getHash = (txn: SafeMultisigTransactionResponse, safeVersion = '1.4.1') =>
    getSafeTxnHash(
      safeVersion.startsWith('1.2')
        ? getSafeV1TypedData(SAFE_ADDRESS, toSafeTx(txn))
        : getSafeTypedData(1n, SAFE_ADDRESS, toSafeTx(txn))
    )
  const reviewed = buildSafeTransaction({
    to: RECIPIENT,
    value: '1',
    data: '0x',
    refundReceiver: ZeroAddress
  })
  let restoreConsole: (() => void) | undefined

  afterEach(() => {
    restoreConsole?.()
    restoreConsole = undefined
  })

  test('accepts a Safe txn that matches its hash', () => {
    const txn = { ...reviewed, safeTxHash: getHash(reviewed) }

    expect(isSafeTxHashValid(txn, SAFE_ADDRESS, 1n, '1.4.1')).toBe(true)
  })

  test('accepts a Safe txn of a Safe before v1.3, whose hash has no chain id', () => {
    const txn = { ...reviewed, safeTxHash: getHash(reviewed, '1.2.0') }

    expect(isSafeTxHashValid(txn, SAFE_ADDRESS, 1n, '1.2.0')).toBe(true)
    expect(isSafeTxHashValid(txn, SAFE_ADDRESS, 1n, '1.4.1')).toBe(false)
  })

  test('rejects a Safe txn whose details are not the ones its hash is for', () => {
    const safeTxHash = getHash(reviewed)

    expect(
      isSafeTxHashValid({ ...reviewed, safeTxHash, value: '2' }, SAFE_ADDRESS, 1n, '1.4.1')
    ).toBe(false)
    expect(
      isSafeTxHashValid({ ...reviewed, safeTxHash, operation: 1 }, SAFE_ADDRESS, 1n, '1.4.1')
    ).toBe(false)
  })

  test('rejects a Safe txn hashed for another Safe or chain', () => {
    const txn = { ...reviewed, safeTxHash: getHash(reviewed) }

    expect(isSafeTxHashValid(txn, OWNER, 1n, '1.4.1')).toBe(false)
    expect(isSafeTxHashValid(txn, SAFE_ADDRESS, 10n, '1.4.1')).toBe(false)
  })

  test('rejects a Safe txn with malformed details', () => {
    restoreConsole = suppressConsole().restore
    const txn = { ...reviewed, safeTxHash: getHash(reviewed), value: 'not a number' }

    expect(isSafeTxHashValid(txn, SAFE_ADDRESS, 1n, '1.4.1')).toBe(false)
  })
})

describe('isSafeMessageHashValid', () => {
  const textMessage = 'Sign in to the app'
  const domain = { name: 'App', version: '1', chainId: '1', verifyingContract: OWNER }
  const mailTypes = { Mail: [{ name: 'contents', type: 'string' }] }
  const typedMessage = {
    domain,
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' }
      ],
      ...mailTypes
    },
    primaryType: 'Mail',
    message: { contents: 'Hello' }
  } as unknown as EIP712TypedData
  // The Safe message hash of a message hash, as the Safe calculates it for its owners to sign
  const getSafeMessageHash = (messageHash: string, safeAddr: Hex = SAFE_ADDRESS, chainId = 1n) =>
    getEIP712Hash(getSafeTypedDataForIsValidSignature(chainId, safeAddr, messageHash))
  const textMessageHash = getSafeMessageHash(hashMessage(textMessage))
  let restoreConsole: (() => void) | undefined

  afterEach(() => {
    restoreConsole?.()
    restoreConsole = undefined
  })

  test('accepts a plain text message that matches its hash', () => {
    expect(
      isSafeMessageHashValid(
        { message: textMessage, messageHash: textMessageHash },
        SAFE_ADDRESS,
        1n
      )
    ).toBe(true)
  })

  test('accepts typed data that matches its hash', () => {
    const messageHash = getSafeMessageHash(
      TypedDataEncoder.hash(domain, mailTypes, { contents: 'Hello' })
    )

    expect(isSafeMessageHashValid({ message: typedMessage, messageHash }, SAFE_ADDRESS, 1n)).toBe(
      true
    )
  })

  test('rejects a message that is not the one its hash is for', () => {
    expect(
      isSafeMessageHashValid(
        { message: 'Send all my tokens', messageHash: textMessageHash },
        SAFE_ADDRESS,
        1n
      )
    ).toBe(false)
  })

  test('rejects a message hashed for another Safe or chain', () => {
    const message = { message: textMessage, messageHash: textMessageHash }

    expect(isSafeMessageHashValid(message, OWNER, 1n)).toBe(false)
    expect(isSafeMessageHashValid(message, SAFE_ADDRESS, 10n)).toBe(false)
  })

  test('rejects a malformed message', () => {
    restoreConsole = suppressConsole().restore
    const message = { domain } as unknown as EIP712TypedData

    expect(
      isSafeMessageHashValid({ message, messageHash: textMessageHash }, SAFE_ADDRESS, 1n)
    ).toBe(false)
  })
})

describe('getVerifiedSafeConfirmations', () => {
  const SAFE_TX_HASH = keccak256(toUtf8Bytes('safe transaction'))
  const owner = new Wallet(keccak256(toUtf8Bytes('owner key')))
  const otherOwner = new Wallet(keccak256(toUtf8Bytes('other owner key')))
  const approvedHashesInterface = new Interface([
    'function approvedHashes(address, bytes32) view returns (uint256)'
  ])
  const getProvider = (approved: bigint) =>
    ({
      call: jest.fn(async () =>
        approvedHashesInterface.encodeFunctionResult('approvedHashes', [approved])
      )
    }) as unknown as RPCProvider
  const confirmation = (ownerAddr: string, signature: string) => ({
    owner: ownerAddr,
    signature,
    signatureType: 'EOA' as const,
    submissionDate: '2026-08-14T00:00:00Z'
  })
  const ecdsaSignature = owner.signingKey.sign(SAFE_TX_HASH).serialized
  let restoreConsole: (() => void) | undefined

  afterEach(() => {
    restoreConsole?.()
    restoreConsole = undefined
  })

  test('keeps the ECDSA signatures of the owners they are attributed to', async () => {
    const ethSign = Signature.from(owner.signingKey.sign(hashMessage(getBytes(SAFE_TX_HASH))))
    const ethSignSignature = concat([ethSign.r, ethSign.s, `0x${(ethSign.v + 4).toString(16)}`])
    const confirmations = [
      confirmation(owner.address, ecdsaSignature),
      confirmation(owner.address, ethSignSignature)
    ]

    await expect(
      getVerifiedSafeConfirmations(SAFE_ADDRESS, SAFE_TX_HASH, confirmations, getProvider(0n))
    ).resolves.toEqual(confirmations)
  })

  test('leaves out an ECDSA signature attributed to another owner', async () => {
    await expect(
      getVerifiedSafeConfirmations(
        SAFE_ADDRESS,
        SAFE_TX_HASH,
        [confirmation(otherOwner.address, ecdsaSignature)],
        getProvider(0n)
      )
    ).resolves.toEqual([])
  })

  test('keeps an approved hash signature only if the owner approved the hash onchain', async () => {
    const approval = confirmation(owner.address, getSafeApprovedHashSignature(owner.address))

    await expect(
      getVerifiedSafeConfirmations(SAFE_ADDRESS, SAFE_TX_HASH, [approval], getProvider(1n))
    ).resolves.toEqual([approval])
    await expect(
      getVerifiedSafeConfirmations(SAFE_ADDRESS, SAFE_TX_HASH, [approval], getProvider(0n))
    ).resolves.toEqual([])
    await expect(
      getVerifiedSafeConfirmations(SAFE_ADDRESS, SAFE_TX_HASH, [approval])
    ).resolves.toEqual([])
  })

  test('leaves out an approved hash signature of another owner', async () => {
    const approval = confirmation(owner.address, getSafeApprovedHashSignature(otherOwner.address))

    await expect(
      getVerifiedSafeConfirmations(SAFE_ADDRESS, SAFE_TX_HASH, [approval], getProvider(1n))
    ).resolves.toEqual([])
  })

  test('leaves out an approved hash signature that could not be checked onchain', async () => {
    restoreConsole = suppressConsole().restore
    const provider = {
      call: jest.fn(async () => {
        throw new Error('RPC down')
      })
    } as unknown as RPCProvider
    const approval = confirmation(owner.address, getSafeApprovedHashSignature(owner.address))

    await expect(
      getVerifiedSafeConfirmations(SAFE_ADDRESS, SAFE_TX_HASH, [approval], provider)
    ).resolves.toEqual([])
  })

  test('leaves out a signature that is not a single Safe signature', async () => {
    const approval = getSafeApprovedHashSignature(owner.address)

    await expect(
      getVerifiedSafeConfirmations(
        SAFE_ADDRESS,
        SAFE_TX_HASH,
        [confirmation(owner.address, concat([ecdsaSignature, approval]))],
        getProvider(1n)
      )
    ).resolves.toEqual([])
  })
})

describe('getSafeAccountByOwner', () => {
  test('falls back to the next deployed network when fetching Safe details fails', async () => {
    const { restore } = suppressConsole()
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
    restore()
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

describe('canHotOwnersMeetSafeThreshold', () => {
  test('is true when the hot owners alone meet the threshold', () => {
    expect(canHotOwnersMeetSafeThreshold([{ type: 'internal' }, { type: 'internal' }], 2)).toBe(
      true
    )
  })

  test('is false when the hot owners are fewer than the threshold', () => {
    expect(canHotOwnersMeetSafeThreshold([{ type: 'internal' }], 2)).toBe(false)
  })

  test('is true when the hot owners meet the threshold next to a hardware wallet or card', () => {
    expect(
      canHotOwnersMeetSafeThreshold(
        [{ type: 'internal' }, { type: 'internal' }, { type: 'ledger' }],
        2
      )
    ).toBe(true)
    expect(canHotOwnersMeetSafeThreshold([{ type: 'internal' }, { type: 'nfc' }], 1)).toBe(true)
  })

  test('is false when the threshold needs a hardware wallet or card', () => {
    expect(canHotOwnersMeetSafeThreshold([{ type: 'internal' }, { type: 'ledger' }], 2)).toBe(false)
    expect(canHotOwnersMeetSafeThreshold([{ type: 'trezor' }, { type: 'nfc' }], 1)).toBe(false)
  })

  test('is false when there are no imported owners', () => {
    expect(canHotOwnersMeetSafeThreshold([], 1)).toBe(false)
  })
})

describe('new Safe accounts', () => {
  const ownerA = '0xD8293ad21678c6F09Da139b4B62D38e514a03B78' as Hex
  const ownerB = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5' as Hex

  // Verified against createProxyWithNonce of the v1.4.1 SafeProxyFactory on Base and Ethereum
  test.each([
    [[ownerA], 1, '0xb89598D5fe26dD671f51F3292096FcDA38B63625'],
    [[ownerA, ownerB], 2, '0x913F170e793293e71749ee6CA674DF0469Ee3735']
  ])('derives the counterfactual address of %j with threshold %i', (owners, threshold, addr) => {
    expect(getNewSafeAccount(owners as Hex[], threshold, []).addr).toBe(addr)
  })

  test('builds a Safe v1.4.1 account with a zero salt nonce', () => {
    const account = getNewSafeAccount([ownerA, ownerB], 1, [])

    expect(account.safeCreation).toEqual({
      factoryAddr: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
      singleton: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
      setupData: expect.any(String),
      saltNonce: zeroPadValue('0x00', 32)
    })
    expect(decodeSetupData(account.safeCreation!.setupData)).toEqual([ownerA, ownerB])
    expect(account.associatedKeys).toEqual([ownerA, ownerB])
    expect(account.initialPrivileges).toEqual([
      [ownerA, '0x01'],
      [ownerB, '0x01']
    ])
    expect(account.creation).toBeNull()
    expect(account.preferences).toEqual({ label: 'Account 1', pfp: account.addr })
  })

  test('labels the new Safe after the accounts already in the wallet', () => {
    const prevAccount = getNewSafeAccount([ownerA], 1, [])

    expect(getNewSafeAccount([ownerB], 1, [prevAccount]).preferences.label).toBe('Account 2')
  })

  test('derives a different address for a different threshold or owners order', () => {
    const addr = getNewSafeAccount([ownerA, ownerB], 1, []).addr

    expect(getNewSafeAccount([ownerA, ownerB], 2, []).addr).not.toBe(addr)
    expect(getNewSafeAccount([ownerB, ownerA], 1, []).addr).not.toBe(addr)
  })

  test('rejects invalid setups', () => {
    expect(() => getNewSafeCreation([], 1)).toThrow('at least one owner')
    expect(() => getNewSafeCreation([ownerA, ownerA.toLowerCase() as Hex], 1)).toThrow('only once')
    expect(() => getNewSafeCreation([ownerA, ZeroAddress as Hex], 1)).toThrow('cannot be an owner')
    expect(() => getNewSafeCreation([SAFE_SENTINEL_OWNER as Hex, ownerA], 1)).toThrow(
      'cannot be an owner'
    )
    expect(() => getNewSafeCreation([ownerA], 0)).toThrow('required confirmations')
    expect(() => getNewSafeCreation([ownerA], 2)).toThrow('required confirmations')
    expect(() => getNewSafeCreation([ownerA, ownerB], 1.5)).toThrow('required confirmations')
  })
})

describe('Safe owner approvals (approveHash)', () => {
  const SAFE_TX_HASH = keccak256(toUtf8Bytes('safe transaction'))
  const ownerKey = new Wallet(keccak256(toUtf8Bytes('owner key')))
  const SMART_ACCOUNT_OWNER = '0x4C71d299f23eFC660b3295D1f631724693aE22Ac'
  const ecdsaSignature = ownerKey.signingKey.sign(SAFE_TX_HASH).serialized as Hex

  test('an approved hash signature is the owner in r, an empty s and v = 1', () => {
    const signature = getSafeApprovedHashSignature(SMART_ACCOUNT_OWNER.toLowerCase())

    expect(getBytes(signature)).toHaveLength(65)
    expect(signature).toBe(
      concat([zeroPadValue(SMART_ACCOUNT_OWNER, 32), zeroPadValue('0x', 32), '0x01']).toLowerCase()
    )
  })

  test('recovers the owner of an approved hash signature next to ECDSA ones', () => {
    const approvedSignature = getSafeApprovedHashSignature(SMART_ACCOUNT_OWNER)
    const combined = sortSigs([approvedSignature, ecdsaSignature], SAFE_TX_HASH)
    const expectedOrder =
      BigInt(SMART_ACCOUNT_OWNER) < BigInt(ownerKey.address)
        ? [SMART_ACCOUNT_OWNER, ownerKey.address]
        : [ownerKey.address, SMART_ACCOUNT_OWNER]

    expect(getAlreadySignedOwners(combined, SAFE_TX_HASH)).toEqual(expectedOrder)
    expect(getSigs(combined)).toHaveLength(2)
    expect(getSigs(combined)).toContain(approvedSignature)
  })

  test('does not take the r of an ECDSA signature as its owner', () => {
    expect(getAlreadySignedOwners(ecdsaSignature, SAFE_TX_HASH)).toEqual([ownerKey.address])
  })

  test('builds the approveHash call to the Safe', () => {
    const call = getSafeApproveHashCall(SAFE_ADDRESS, SAFE_TX_HASH)

    expect(call.to).toBe(getAddress(SAFE_ADDRESS))
    expect(call.value).toBe(0n)
    expect(
      new Interface(['function approveHash(bytes32)']).decodeFunctionData(
        'approveHash',
        call.data
      )[0]
    ).toBe(SAFE_TX_HASH)
  })

  test('reads whether an owner approved the hash onchain', async () => {
    const approvedHashesInterface = new Interface([
      'function approvedHashes(address, bytes32) view returns (uint256)'
    ])
    const getProvider = (approved: bigint) => {
      const call = jest.fn<RPCProvider['call']>(async () =>
        approvedHashesInterface.encodeFunctionResult('approvedHashes', [approved])
      )
      return { provider: { call } as unknown as RPCProvider, call }
    }

    const approved = getProvider(1n)
    await expect(
      isSafeHashApproved(SAFE_ADDRESS, SMART_ACCOUNT_OWNER, SAFE_TX_HASH, approved.provider)
    ).resolves.toBe(true)
    expect(approved.call).toHaveBeenCalledWith(
      expect.objectContaining({
        data: approvedHashesInterface.encodeFunctionData('approvedHashes', [
          SMART_ACCOUNT_OWNER,
          SAFE_TX_HASH
        ])
      })
    )

    const notApproved = getProvider(0n)
    await expect(
      isSafeHashApproved(SAFE_ADDRESS, SMART_ACCOUNT_OWNER, SAFE_TX_HASH, notApproved.provider)
    ).resolves.toBe(false)
  })
})

describe('getPendingTransactions', () => {
  const originalApiKey = process.env.SAFE_API_KEY
  const emptyListResponse: SafeMultisigTransactionListResponse = { count: 0, results: [] }

  beforeEach(() => {
    // getApiKit refuses to build a client without one; no request leaves the test
    process.env.SAFE_API_KEY = 'test-api-key'
  })

  afterEach(() => {
    process.env.SAFE_API_KEY = originalApiKey
    jest.restoreAllMocks()
  })

  test('asks only for the not executed txns from the passed nonce, without fetching the Safe info', async () => {
    const getMultisigTransactions = jest
      .spyOn(SafeApiKit.prototype, 'getMultisigTransactions')
      .mockResolvedValue(emptyListResponse)
    const getSafeInfo = jest.spyOn(SafeApiKit.prototype, 'getSafeInfo')

    const response = await getPendingTransactions(1n, SAFE_ADDRESS, 12n)

    expect(getMultisigTransactions).toHaveBeenCalledTimes(1)
    expect(getMultisigTransactions).toHaveBeenCalledWith(SAFE_ADDRESS, {
      executed: false,
      nonce__gte: '12',
      ordering: 'nonce'
    })
    expect(getSafeInfo).not.toHaveBeenCalled()
    expect(response).toEqual({ ...emptyListResponse, chainId: 1n, type: 'txn' })
  })

  test('does not fetch the Safe info for a Safe that has not executed a txn yet (nonce 0)', async () => {
    const getMultisigTransactions = jest
      .spyOn(SafeApiKit.prototype, 'getMultisigTransactions')
      .mockResolvedValue(emptyListResponse)
    const getSafeInfo = jest.spyOn(SafeApiKit.prototype, 'getSafeInfo')

    await getPendingTransactions(1n, SAFE_ADDRESS, 0n)

    expect(getMultisigTransactions).toHaveBeenCalledWith(
      SAFE_ADDRESS,
      expect.objectContaining({ executed: false, nonce__gte: '0' })
    )
    expect(getSafeInfo).not.toHaveBeenCalled()
  })

  test('passes the Safe API error on to the caller', async () => {
    jest
      .spyOn(SafeApiKit.prototype, 'getMultisigTransactions')
      .mockRejectedValue(new Error('Too many requests'))

    await expect(getPendingTransactions(1n, SAFE_ADDRESS, 3n)).rejects.toThrow('Too many requests')
  })
})

describe('Safe API requests made by the background Safe checks', () => {
  const originalApiKey = process.env.SAFE_API_KEY
  const emptyListResponse: SafeMultisigTransactionListResponse = { count: 0, results: [] }
  const never = <T>() => new Promise<T>(() => {})
  let restoreConsole: (() => void) | undefined

  beforeEach(() => {
    // getApiKit refuses to build a client without one; no request leaves the test
    process.env.SAFE_API_KEY = 'test-api-key'
    jest.useFakeTimers()
  })

  afterEach(() => {
    restoreConsole?.()
    restoreConsole = undefined
    jest.useRealTimers()
    process.env.SAFE_API_KEY = originalApiKey
    jest.restoreAllMocks()
  })

  test('the pending txns request stops waiting for a Safe API that never answers', async () => {
    jest.spyOn(SafeApiKit.prototype, 'getMultisigTransactions').mockImplementation(() => never())

    const request = getPendingTransactions(1n, SAFE_ADDRESS, 3n)
    const assertion = expect(request).rejects.toThrow(
      `Safe API: get pending transactions timed out after ${SAFE_API_TIMEOUT_MS}ms`
    )
    await jest.advanceTimersByTimeAsync(SAFE_API_TIMEOUT_MS)

    await assertion
  })

  test('the pending txns request is not cut short just before the timeout', async () => {
    let answer: ((response: typeof emptyListResponse) => void) | undefined
    jest.spyOn(SafeApiKit.prototype, 'getMultisigTransactions').mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )

    const request = getPendingTransactions(1n, SAFE_ADDRESS, 3n)
    await jest.advanceTimersByTimeAsync(SAFE_API_TIMEOUT_MS - 1)
    answer?.(emptyListResponse)

    await expect(request).resolves.toEqual({ ...emptyListResponse, chainId: 1n, type: 'txn' })
    // the timeout timer is cleared once the Safe API answers
    expect(jest.getTimerCount()).toBe(0)
  })

  test('the messages request stops waiting for a Safe API that never answers', async () => {
    jest.spyOn(SafeApiKit.prototype, 'getMessages').mockImplementation(() => never())

    const request = getLatestMessages(1n, SAFE_ADDRESS)
    const assertion = expect(request).rejects.toThrow(
      `Safe API: get messages timed out after ${SAFE_API_TIMEOUT_MS}ms`
    )
    await jest.advanceTimersByTimeAsync(SAFE_API_TIMEOUT_MS)

    await assertion
  })

  test('a message that never arrives is treated as not found', async () => {
    restoreConsole = suppressConsole().restore
    jest.spyOn(SafeApiKit.prototype, 'getMessage').mockImplementation(() => never())

    const request = getMessage({ chainId: 1n, threshold: 1, messageHash: '0x01' })
    await jest.advanceTimersByTimeAsync(SAFE_API_TIMEOUT_MS)

    await expect(request).resolves.toBeNull()
  })

  test('the executed txns of the chains that answer are returned when another chain never answers', async () => {
    restoreConsole = suppressConsole().restore
    const executedTxn = buildSafeTransaction({
      nonce: '4',
      transactionHash: `0x${'2'.repeat(64)}`
    })
    jest
      .spyOn(SafeApiKit.prototype, 'getMultisigTransactions')
      .mockImplementationOnce(() => never())
      .mockResolvedValueOnce({ ...emptyListResponse, count: 1, results: [executedTxn] })

    const request = fetchExecutedTransactions(SAFE_ADDRESS, [
      { chainId: 1n, minNonce: 4 },
      { chainId: 10n, minNonce: 4 }
    ])
    await jest.advanceTimersByTimeAsync(SAFE_API_TIMEOUT_MS)

    await expect(request).resolves.toEqual([
      {
        chainId: 10n,
        safeTxnHash: executedTxn.safeTxHash,
        transactionHash: executedTxn.transactionHash,
        nonce: '4'
      }
    ])
  })
})
