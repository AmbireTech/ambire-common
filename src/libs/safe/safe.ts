import {
  AbiCoder,
  concat,
  Contract,
  getAddress,
  getCreate2Address,
  hexlify,
  id,
  Interface,
  keccak256,
  recoverAddress,
  toBeHex,
  toUtf8Bytes,
  TransactionResponse,
  ZeroAddress,
  zeroPadValue
} from 'ethers'

import { SignTypedDataVersion, TypedDataUtils } from '@metamask/eth-sig-util'
import SafeApiKit from '@safe-global/api-kit'

import SafeAbi from '../../../contracts/compiled/Safe.json'
import { SAFE_API_TIMEOUT_MS, SAFE_V1_4_1 } from '../../consts/safe'
import { Account, SafeAccountCreation } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { Key } from '../../interfaces/keystore'
import { RPCProvider } from '../../interfaces/provider'
import { SafeAccountByOwner, SafeTx } from '../../interfaces/safe'
import { CallsUserRequest, TypedMessageUserRequest } from '../../interfaces/userRequest'
import { paginate } from '../../utils/paginate'
import wait from '../../utils/wait'
import { withTimeout } from '../../utils/with-timeout'
import { Call } from '../accountOp/types'
import { adaptTypedMessageForMetaMaskSigUtil } from '../signMessage/signMessage'
import {
  decodeMultiSend,
  multiCallAbi,
  parseSafeMessageOrigin,
  SuccessfullyDecoded
} from './helpers'

import type {
  AddMessageOptions,
  ProposeTransactionProps,
  SafeCreationInfoResponse,
  SafeMessage,
  SafeMessageListResponse,
  SafeMultisigTransactionListResponse
} from '@safe-global/api-kit'
import type {
  EIP712TypedData,
  SafeMultisigConfirmationResponse,
  SafeMultisigTransactionResponse
} from '@safe-global/types-kit'

export type ExtendedSafeMessage = SafeMessage & { isConfirmed: boolean }

export interface SafeResults {
  [chainId: string]: {
    txns: SafeMultisigTransactionResponse[]
    messages: ExtendedSafeMessage[]
  }
}

export function getApiKit(chainId: bigint) {
  return new SafeApiKit({
    chainId,
    apiKey: process.env.SAFE_API_KEY
  })
}

type SafeDeploymentApiKitFactory = (
  chainId: bigint
) => Pick<ReturnType<typeof getApiKit>, 'getSafeCreationInfo'>

type SafeAccountApiKitFactory = (
  chainId: bigint
) => Pick<ReturnType<typeof getApiKit>, 'getSafeInfo' | 'getSafeCreationInfo'>

export async function getSafeAccountByOwner(
  safeAddr: string,
  owner: Hex,
  deployedOn: bigint[],
  apiKitFactory: SafeAccountApiKitFactory = getApiKit
): Promise<{ account: SafeAccountByOwner | null; failed: boolean }> {
  const getAccountFromChain = async (
    [chainId, ...remainingChainIds]: bigint[],
    hasRequestFailed = false
  ): Promise<{
    account: SafeAccountByOwner | null
    failed: boolean
  }> => {
    if (chainId === undefined) return { account: null, failed: hasRequestFailed }

    const apiKit = apiKitFactory(chainId)
    try {
      const safeInfo = await withTimeout(() => apiKit.getSafeInfo(safeAddr), {
        timeoutMs: SAFE_API_TIMEOUT_MS,
        message: `Safe API: get Safe info timed out after ${SAFE_API_TIMEOUT_MS}ms`
      })
      const address = getAddress(safeAddr.toLowerCase())
      const owners = safeInfo.owners.map((safeOwner: string) => getAddress(safeOwner.toLowerCase()))
      if (!owners.some((safeOwner) => safeOwner === owner)) {
        return getAccountFromChain(remainingChainIds, hasRequestFailed)
      }

      const safeCreationInfo = await withTimeout(() => apiKit.getSafeCreationInfo(safeAddr), {
        timeoutMs: SAFE_API_TIMEOUT_MS,
        message: `Safe API: get Safe creation info timed out after ${SAFE_API_TIMEOUT_MS}ms`
      })

      return {
        account: {
          addr: address,
          associatedKeys: owners,
          initialPrivileges: owners.map((safeOwner) => [safeOwner, '0x01']),
          creation: null,
          safeCreation: {
            factoryAddr: safeCreationInfo.factoryAddress as Hex,
            singleton: safeCreationInfo.singleton as Hex,
            setupData: safeCreationInfo.setupData as Hex,
            saltNonce: safeCreationInfo.saltNonce
              ? (toBeHex(BigInt(safeCreationInfo.saltNonce), 32) as Hex)
              : (toBeHex(0, 32) as Hex)
          },
          preferences: {
            label: 'Safe',
            pfp: address
          },
          deployedOn
        },
        failed: false
      }
    } catch (error) {
      console.error(
        `Failed to retrieve Safe account ${safeAddr} on network ${chainId.toString()}`,
        error
      )
      return getAccountFromChain(remainingChainIds, true)
    }
  }

  return getAccountFromChain(deployedOn)
}

export async function getCalculatedSafeAddress(
  creation: SafeCreationInfoResponse,
  provider: RPCProvider
): Promise<Hex | null> {
  return getCalculatedSafeAddressFromCreation(
    {
      factoryAddr: creation.factoryAddress as Hex,
      singleton: creation.singleton as Hex,
      setupData: creation.setupData as Hex,
      saltNonce: toBeHex(BigInt(creation.saltNonce || 0), 32) as Hex
    },
    provider
  )
}

/**
 * Derives the CREATE2 address a SafeProxyFactory deploys a Safe proxy to,
 * the same way its createProxyWithNonce does.
 */
export function getSafeProxyAddress(creation: SafeAccountCreation, proxyCreationCode: Hex): Hex {
  const salt = keccak256(
    concat([keccak256(creation.setupData), zeroPadValue(creation.saltNonce, 32)])
  )
  const bytecode = concat([
    proxyCreationCode,
    new AbiCoder().encode(['address'], [creation.singleton])
  ]) as Hex
  return getCreate2Address(creation.factoryAddr, salt, keccak256(bytecode)) as Hex
}

async function getCalculatedSafeAddressFromCreation(
  creation: SafeAccountCreation,
  provider: RPCProvider
): Promise<Hex | null> {
  const factoryAbi = ['function proxyCreationCode() view returns (bytes)']
  const factory = new Contract(creation.factoryAddr, factoryAbi, provider)
  let proxyCreationCode
  try {
    proxyCreationCode = await (factory as any).proxyCreationCode()
  } catch (e) {
    console.error(
      `failed to call proxyCreationCode on Safe factory with addr: ${creation.factoryAddr}`,
      e
    )
    return null
  }
  return getSafeProxyAddress(creation, proxyCreationCode)
}

const safeSetupInterface = new Interface([
  'function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment,address payable paymentReceiver)'
])

/**
 * Builds the creation data of a new Safe v1.4.1 account with the given owners and threshold.
 * The salt nonce is always zero, so the same owners (in the same order) and threshold
 * always result in the same Safe address.
 */
export function getNewSafeCreation(owners: Hex[], threshold: number): SafeAccountCreation {
  if (!owners.length) throw new Error('A Safe account needs at least one owner.')
  if (new Set(owners.map((owner) => owner.toLowerCase())).size !== owners.length) {
    throw new Error('Each Safe account owner can be added only once.')
  }
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) {
    throw new Error(
      'The number of required confirmations must be between one and the number of owners.'
    )
  }

  return {
    factoryAddr: SAFE_V1_4_1.proxyFactory,
    singleton: SAFE_V1_4_1.singletonL2,
    setupData: safeSetupInterface.encodeFunctionData('setup', [
      owners.map((owner) => getAddress(owner)),
      threshold,
      // no delegate call during setup
      ZeroAddress,
      '0x',
      SAFE_V1_4_1.compatibilityFallbackHandler,
      // no deployment payment
      ZeroAddress,
      0,
      ZeroAddress
    ]) as Hex,
    saltNonce: toBeHex(0, 32) as Hex
  }
}

/**
 * Builds a new, not yet deployed Safe v1.4.1 account with the given owners and threshold.
 * Its address is the counterfactual address the Safe will be deployed to.
 */
export function getNewSafeAccount(owners: Hex[], threshold: number): Account {
  const safeCreation = getNewSafeCreation(owners, threshold)
  const addr = getAddress(getSafeProxyAddress(safeCreation, SAFE_V1_4_1.proxyCreationCode))
  const associatedKeys = owners.map((owner) => getAddress(owner))

  return {
    addr,
    associatedKeys,
    initialPrivileges: associatedKeys.map((owner) => [owner, '0x01']),
    creation: null,
    safeCreation,
    preferences: {
      label: 'Safe',
      pfp: addr
    }
  }
}

const safeProxyFactoryInterface = new Interface([
  'function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce)',
  // v1.5.0+: calls createProxyWithNonce internally, so it uses the same salt and derives the
  // same address, which makes its deployment data reusable on other chains
  'function createProxyWithNonceL2(address _singleton, bytes initializer, uint256 saltNonce)'
])
/**
 * Factory functions whose deployment data can be replayed on other chains. Chain specific and
 * callback deployments are intentionally excluded as they don't derive the same address elsewhere.
 */
const crossChainSafeDeployFunctions = ['createProxyWithNonce', 'createProxyWithNonceL2'] as const
const getSafeProxyFactorySelector = (
  functionName: (typeof crossChainSafeDeployFunctions)[number]
): string => safeProxyFactoryInterface.getFunction(functionName)!.selector.slice(2)
const proxyCreationTopic = id('ProxyCreation(address,address)')

/** Returns whether all fields required to redeploy a Safe are available. */
export function hasCompleteSafeCreationData(
  creation: Partial<SafeAccountCreation> | null | undefined
): boolean {
  return !!(
    creation?.factoryAddr &&
    creation.factoryAddr !== '0x' &&
    creation.singleton &&
    creation.singleton !== '0x' &&
    creation.setupData &&
    creation.setupData !== '0x' &&
    creation.saltNonce &&
    creation.saltNonce !== '0x'
  )
}

function decodeSafeDeploymentCalls(
  transactionData: string,
  factoryAddr: Hex,
  functionName: (typeof crossChainSafeDeployFunctions)[number]
): SafeAccountCreation[] {
  const safeProxyFactorySelector = getSafeProxyFactorySelector(functionName)
  const normalizedTransactionData = transactionData.toLowerCase()
  const deploymentData = []
  let selectorIndex = normalizedTransactionData.indexOf(safeProxyFactorySelector)

  while (selectorIndex !== -1) {
    try {
      const [singleton, setupData, saltNonce] = safeProxyFactoryInterface.decodeFunctionData(
        functionName,
        `0x${transactionData.slice(selectorIndex)}`
      )
      deploymentData.push({
        factoryAddr,
        singleton: getAddress(singleton) as Hex,
        setupData: hexlify(setupData) as Hex,
        saltNonce: toBeHex(saltNonce, 32) as Hex
      })
    } catch {
      // The selector can occur in unrelated calldata. Continue looking for a valid deployment call.
    }

    selectorIndex = normalizedTransactionData.indexOf(
      safeProxyFactorySelector,
      selectorIndex + safeProxyFactorySelector.length
    )
  }

  return deploymentData
}

function decodeSafeDeploymentData(
  transactionData: string,
  factoryAddr: Hex
): SafeAccountCreation[] {
  return crossChainSafeDeployFunctions.flatMap((functionName) =>
    decodeSafeDeploymentCalls(transactionData, factoryAddr, functionName)
  )
}

/**
 * Finds the Safe factory that deployed safeAddr. Uses transaction.to when the factory was called
 * directly; otherwise locates the ProxyCreation event emitted for safeAddr in the deploy receipt,
 * which works regardless of how the factory call was wrapped (4337, MultiSend, relayers, etc.)
 */
async function findFactoryAddr(
  transaction: TransactionResponse,
  safeAddr: string,
  provider: RPCProvider
): Promise<Hex | null> {
  // lucky guess: if the call is to the factory, just take it directly
  if (
    transaction.to &&
    crossChainSafeDeployFunctions.some((functionName) =>
      transaction.data.toLowerCase().startsWith(`0x${getSafeProxyFactorySelector(functionName)}`)
    )
  ) {
    return getAddress(transaction.to) as Hex
  }

  // take the receipt, find the deploy log and take the factory from there
  const receipt = await provider.getTransactionReceipt(transaction.hash).catch((e: Error) => e)
  if (receipt instanceof Error) {
    console.error('failed to fetch the Safe deploy receipt', receipt)
    return null
  }
  if (!receipt) return null

  const paddedSafeAddr = zeroPadValue(safeAddr, 32).toLowerCase()
  const proxyCreationLog = receipt.logs.find(
    (log) =>
      log.topics[0] === proxyCreationTopic &&
      // v1.4.1+ indexes proxy (topics[1]); v1.3.0 has it as the first word of data
      (log.topics[1]?.toLowerCase() === paddedSafeAddr ||
        log.data.toLowerCase().startsWith(paddedSafeAddr))
  )

  return proxyCreationLog ? (getAddress(proxyCreationLog.address) as Hex) : null
}

/**
 * Returns the Safe creation data available from the Safe Transaction Service, recovering missing
 * fields from the validated deployment transaction when possible.
 */
export async function findDeployData(
  safeAddr: string,
  chainId: bigint,
  provider: RPCProvider,
  apiKitFactory: SafeDeploymentApiKitFactory = getApiKit
): Promise<SafeAccountCreation | Error> {
  const creationInfo = await withTimeout(
    () => apiKitFactory(chainId).getSafeCreationInfo(safeAddr),
    {
      timeoutMs: SAFE_API_TIMEOUT_MS,
      message: `Safe API: get Safe creation info timed out after ${SAFE_API_TIMEOUT_MS}ms`
    }
  ).catch((e: Error) => e)

  // on timeout or problems with the Safe API, return an error
  // the caller should not proceed in this case
  if (creationInfo instanceof Error) return creationInfo

  const safeCreation = {
    factoryAddr: (creationInfo.factoryAddress || '0x') as Hex,
    singleton: (creationInfo.singleton || '0x') as Hex,
    setupData: (creationInfo.setupData || '0x') as Hex,
    saltNonce:
      creationInfo.saltNonce !== null && creationInfo.saltNonce !== undefined
        ? (toBeHex(BigInt(creationInfo.saltNonce), 32) as Hex)
        : '0x'
  }

  if (hasCompleteSafeCreationData(safeCreation)) return safeCreation

  // if there's no transactionHash, we cannot find additional data,
  // but we pass back the found safeCreation until now
  if (!creationInfo.transactionHash) return safeCreation

  const transaction = await provider
    .getTransaction(creationInfo.transactionHash)
    .catch((e: Error) => e)

  // if the provider step fails, we cannot add additional data,
  // but we still pass back the found safeCreation until now
  if (transaction instanceof Error || !transaction?.data) return safeCreation

  // if factoryAddr is missing for whatever reason, try to locate it
  // from the transaction itself
  let factoryAddr = safeCreation.factoryAddr
  if (factoryAddr === '0x') {
    factoryAddr = (await findFactoryAddr(transaction, safeAddr, provider)) ?? '0x'
  }

  // if we cannot locate the factoryAddr, we return the data and move on
  if (factoryAddr === '0x') return safeCreation

  factoryAddr = getAddress(factoryAddr) as Hex
  const deploymentData = decodeSafeDeploymentData(transaction.data, factoryAddr)

  for (const candidate of deploymentData) {
    const calculatedAddress = await getCalculatedSafeAddressFromCreation(candidate, provider)
    if (calculatedAddress?.toLowerCase() !== safeAddr.toLowerCase()) continue

    return candidate
  }

  return safeCreation
}

/**
 * Builds a Safe deployment call only when the stored creation data derives the imported address
 * and the configured singleton is deployed on the target network.
 */
export async function getSafeDeploymentCall(
  account: Account,
  provider: RPCProvider
): Promise<Call | null> {
  if (!account.safeCreation) return null

  try {
    const calculatedAddress = await getCalculatedSafeAddressFromCreation(
      account.safeCreation,
      provider
    )
    if (!calculatedAddress || calculatedAddress.toLowerCase() !== account.addr.toLowerCase()) {
      return null
    }

    const singletonCode = await provider.getCode(account.safeCreation.singleton)
    if (singletonCode === '0x') return null

    return {
      to: account.safeCreation.factoryAddr,
      value: 0n,
      data: safeProxyFactoryInterface.encodeFunctionData('createProxyWithNonce', [
        account.safeCreation.singleton,
        account.safeCreation.setupData,
        account.safeCreation.saltNonce
      ]) as Hex
    }
  } catch (error) {
    console.error(`failed to build Safe deployment call for ${account.addr}`, error)
    return null
  }
}

/**
 * The setup() method is the same for v1.3, 1.4.1, 1.5. We decode it
 * to fetch the initial owners of the Safe so that we could put them
 * in the account associatedKeys
 */
export function decodeSetupData(setupData: Hex): Hex[] {
  const setupMethodAbi = [
    'function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment,address payable paymentReceiver)'
  ]
  const setupMethodInterface = new Interface(setupMethodAbi)
  let decoded = null
  try {
    decoded = setupMethodInterface.decodeFunctionData('setup', setupData)
  } catch (e) {
    console.error('failed to decode the Safe setup data', e)
    return []
  }

  return Object.keys(decoded[0]).map((key) => decoded[0][key])
}

/**
 * In Safe, the signatures need to be in order, starting with
 * the smallest ecrecover(sig) owner, ascending. Here, we
 * sort the owners in that way
 */
export function sortByAddress<T extends { addr: string }>(sortableKeys: T[]): T[] {
  return sortableKeys.sort((a, b) => {
    const aBig = BigInt(a.addr.toLowerCase())
    const bBig = BigInt(b.addr.toLowerCase())
    return aBig < bBig ? -1 : aBig > bBig ? 1 : 0
  })
}

export function getSafeTxnHash(typedData: TypedMessageUserRequest['meta']['params']) {
  return `0x${TypedDataUtils.eip712Hash(
    adaptTypedMessageForMetaMaskSigUtil({ ...typedData }),
    SignTypedDataVersion.V4
  ).toString('hex')}`
}

export async function propose(
  txn: SafeTx,
  chainId: bigint,
  safeAddress: Hex,
  owner: Hex,
  ownerSig: Hex,
  safeTxHash: string
) {
  const apiKit = getApiKit(chainId)
  const proposeTransactionProps: ProposeTransactionProps = {
    safeAddress: getAddress(safeAddress),
    safeTxHash: safeTxHash,
    safeTransactionData: {
      ...txn,
      to: getAddress(txn.to),
      baseGas: BigInt(txn.baseGas).toString(),
      gasPrice: BigInt(txn.gasPrice).toString(),
      safeTxGas: BigInt(txn.safeTxGas).toString(),
      value: BigInt(txn.value).toString(),
      nonce: parseInt(txn.nonce)
    },
    senderAddress: owner,
    senderSignature: ownerSig
  }

  return apiKit.proposeTransaction(proposeTransactionProps)
}

export async function confirm(chainId: bigint, ownerSig: Hex, safeTxHash: string) {
  const apiKit = getApiKit(chainId)
  return apiKit.confirmTransaction(safeTxHash, ownerSig)
}

export async function addMessage(
  chainId: bigint,
  safeAddress: Hex,
  message: string | EIP712TypedData,
  signature: string,
  origin?: string
) {
  const apiKit = getApiKit(chainId)
  // `origin` is a free-form field the Safe Transaction Service persists and returns
  // on the message. api-kit doesn't type it, but it forwards the options as the POST
  // body verbatim, so we widen the payload to carry it through.
  const options: AddMessageOptions & { origin?: string } = {
    message: normalizeSafeGlobalMessage(message),
    signature
  }
  if (origin) options.origin = origin
  return apiKit.addMessage(safeAddress, options)
}

export function normalizeSafeGlobalMessage(message: string | EIP712TypedData) {
  if (typeof message === 'string') return message
  const chainId = (message.domain as { chainId?: unknown }).chainId
  if (typeof chainId !== 'bigint') return message

  return {
    ...message,
    domain: {
      ...message.domain,
      chainId: chainId.toString()
    }
  } as unknown as EIP712TypedData
}

export async function getMessage({
  chainId,
  threshold,
  messageHash
}: {
  chainId: bigint
  threshold: number
  messageHash: Hex
}): Promise<ExtendedSafeMessage | null> {
  const apiKit = getApiKit(chainId)
  const msg = await apiKit.getMessage(messageHash).catch((e) => {
    console.log('safe message not found', e)
    return null
  })
  if (!msg) return null
  return {
    ...msg,
    isConfirmed: msg.confirmations.length >= threshold
  }
}

export async function addMessageSignature(chainId: bigint, hash: string, signature: string) {
  const apiKit = getApiKit(chainId)
  return apiKit.addMessageSignature(hash, signature)
}

export async function getPendingTransactions(
  chainId: bigint,
  safeAddress: Hex
): Promise<SafeMultisigTransactionListResponse & { chainId: bigint; type: string }> {
  const apiKit = getApiKit(chainId)
  const response = await apiKit.getPendingTransactions(safeAddress, {
    ordering: 'nonce'
  })
  return { ...response, chainId, type: 'txn' }
}

/**
 * Due to the nature of signatures, we cannot ask for confirmed
 * signatures as the moment the threshold for the account changes,
 * the validity of the signatures change as well.
 * Removing an owner would do the same.
 * So we fetch the newest 15 and filter them on a higher level
 */
export async function getLatestMessages(
  chainId: bigint,
  safeAddress: Hex
): Promise<SafeMessageListResponse & { chainId: bigint; type: string }> {
  const apiKit = getApiKit(chainId)
  const response = await apiKit.getMessages(safeAddress, {
    ordering: '-created',
    limit: 15
  })
  const currentTime = new Date().getTime()
  const oneWeek = 7 * 24 * 60 * 60 * 1000
  // filter messages older than one week
  const finalRes = response.results.filter(
    (m) => new Date(m.created).getTime() + oneWeek > currentTime
  )
  return { ...response, results: finalRes, chainId, type: 'message' }
}

export async function fetchAllPending(
  networks: { chainId: bigint; threshold: number }[],
  safeAddr: Hex
): Promise<SafeResults | null> {
  const results: SafeResults = {}
  for (let i = 0; i < networks.length; i++) {
    const network = networks[i]!
    const responses = await Promise.all([
      getPendingTransactions(network.chainId, safeAddr),
      getLatestMessages(network.chainId, safeAddr)
    ])
    responses.forEach((r) => {
      if (!results[r.chainId.toString()]) results[r.chainId.toString()] = { txns: [], messages: [] }

      if (r.type === 'txn')
        results[r.chainId.toString()]!.txns = r.results as SafeMultisigTransactionResponse[]
      else
        results[r.chainId.toString()]!.messages = r.results.map((r) => {
          return { ...r, isConfirmed: (r.confirmations?.length || 0) >= network.threshold }
        }) as ExtendedSafeMessage[]
    })
  }

  return results
}

export function toCallsUserRequest(
  safeAddr: Hex,
  response: SafeResults
): {
  type: 'calls'
  params: {
    userRequestParams: {
      calls: CallsUserRequest['signAccountOp']['accountOp']['calls']
      meta: CallsUserRequest['meta'] & {
        safeTxnProps: { txnId: Hex; signature: Hex; nonce: bigint }
        safeTx: SafeMultisigTransactionResponse
      }
    }
    executionType: 'queue'
  }
}[] {
  const userRequests: {
    type: 'calls'
    params: {
      userRequestParams: {
        calls: CallsUserRequest['signAccountOp']['accountOp']['calls']
        meta: CallsUserRequest['meta'] & {
          safeTxnProps: { txnId: Hex; signature: Hex; nonce: bigint }
          safeTx: SafeMultisigTransactionResponse
        }
      }
      executionType: 'queue'
    }
  }[] = []

  Object.keys(response).forEach((chainId: string) => {
    const txns = response[chainId]!.txns
    txns.forEach((txn) => {
      let calls: CallsUserRequest['signAccountOp']['accountOp']['calls'] = []
      try {
        // try to decode the data to check if it's a batch
        // if it is, use it; otherwise, construct a single call reqx
        const multisendInterface = new Interface(multiCallAbi)
        const multiSendCall = multisendInterface.decodeFunctionData('multiSend', txn.data!)
        const decodedCalls = decodeMultiSend(multiSendCall[0])
        if (!decodedCalls.every((call): call is SuccessfullyDecoded => call.success)) {
          throw new Error('failed to decode one or more multiSend calls')
        }
        calls = decodedCalls.map((call) => ({
          to: call.to,
          value: call.value,
          data: call.data
        }))
      } catch {
        // this just means it's not a batch
        calls = [{ to: txn.to, value: BigInt(txn.value), data: txn.data || '0x' }]
      }

      const signature = txn.confirmations
        ? sortSigs(
            txn.confirmations.map((c) => c.signature as Hex),
            txn.safeTxHash,
            txn.confirmations
          )
        : null
      if (!signature) return
      userRequests.push({
        type: 'calls',
        params: {
          userRequestParams: {
            calls,
            meta: {
              accountAddr: safeAddr,
              chainId: BigInt(chainId),
              safeTxnProps: {
                txnId: txn.safeTxHash as Hex,
                signature,
                nonce: BigInt(txn.nonce)
              },
              safeTx: txn
            }
          },
          executionType: 'queue'
        }
      })
    })
  })

  return userRequests
}

export function toSigMessageUserRequests(response: SafeResults): {
  type: 'safeSignMessageRequest'
  params: {
    chainId: bigint
    signed: string[]
    message: Hex | EIP712TypedData
    messageHash: Hex
    signature: Hex
    created: number
    signatures: Hex[]
    dappName?: string
    dappUrl?: string
  }
  isConfirmed: boolean
}[] {
  const userRequests: {
    type: 'safeSignMessageRequest'
    params: {
      chainId: bigint
      signed: string[]
      message: Hex | EIP712TypedData
      messageHash: Hex
      signature: Hex
      created: number
      signatures: Hex[]
      dappName?: string
      dappUrl?: string
    }
    isConfirmed: boolean
  }[] = []

  Object.keys(response).forEach((chainId: string) => {
    const messages = response[chainId]!.messages
    messages.forEach((message) => {
      const signature = message.confirmations
        ? (concat(message.confirmations.map((c) => c.signature)) as Hex)
        : null
      if (!signature) return

      const { name: dappName, url: dappUrl } = parseSafeMessageOrigin(message.origin)

      userRequests.push({
        type: 'safeSignMessageRequest',
        params: {
          chainId: BigInt(chainId),
          signed: message.confirmations.map((confirm) => confirm.owner),
          message:
            typeof message.message === 'string'
              ? (hexlify(toUtf8Bytes(message.message)) as Hex)
              : message.message,
          messageHash: message.messageHash as Hex,
          signature: sortSigs(
            message.confirmations.map((c) => c.signature) as Hex[],
            message.messageHash,
            message.confirmations
          ),
          created: new Date(message.created).getTime(),
          signatures: message.confirmations.map((c) => c.signature) as Hex[],
          dappName,
          dappUrl
        },
        isConfirmed: !!message.isConfirmed
      })
    })
  })

  return userRequests
}

function getOwnerFromSafeTx(
  sig: string,
  confirmations?: { owner: string; signature: string }[]
): string | undefined {
  return confirmations?.find((c) => c.signature === sig)?.owner
}

function recoverOwner(
  sig: string,
  hash: string,
  confirmations?: { owner: string; signature: string }[]
) {
  // a transaction from Safe Global may have signatures that are not
  // ecdsa; therefore, we cannot extract the owner from them by using
  // a plain recoverAddress. We rely on the Safe Global information
  const safeOwner = getOwnerFromSafeTx(sig, confirmations)
  if (safeOwner) return safeOwner

  // an ambire sig is always ecdsa
  return recoverAddress(hash, sig)
}

// the signature is 130 x number_of_sigs + 2 (0x) symbols long
// so we cut the hex (0x) from the beginning
// then take each sig (substring(0, 130)) and recover the address
// finally, we update everything
export function getAlreadySignedOwners(
  signature: string,
  hash: string,
  safeTx?: SafeMultisigTransactionResponse
): string[] {
  const signatures = signature.substring(2)
  const signed = []
  for (let i = 0; i < signatures.length; i += 130) {
    const sig = `0x${signatures.substring(i, i + 130)}`
    signed.push(recoverOwner(sig, hash, safeTx?.confirmations))
  }
  return signed
}

export function getImportedSignersThatHaveNotSigned(
  signed: string[],
  importedOwners: string[]
): string[] {
  return importedOwners.filter((o) => !signed.includes(o))
}

/**
 * Whether the imported owners of a Safe can reach its threshold with hot (keystore held) keys
 * alone. Hardware wallets and cards confirm on the device, so they do not count towards it.
 */
export function canHotOwnersMeetSafeThreshold(
  importedOwners: Pick<Key, 'type'>[],
  threshold: number
): boolean {
  return importedOwners.filter(({ type }) => type === 'internal').length >= threshold
}

export function getSigs(signature?: string | null): Hex[] {
  if (!signature) return []
  const signed: Hex[] = []
  const signatures = signature.substring(2)
  for (let i = 0; i < signatures.length; i += 130) {
    signed.push(`0x${signatures.substring(i, i + 130)}` as Hex)
  }
  return signed
}

export function sortSigs(
  signatures: Hex[],
  hash: string,
  confirmations?: { owner: string; signature: string }[]
): Hex {
  const signed: { sig: string; addr: string }[] = []

  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i]!
    signed.push({ sig, addr: recoverOwner(sig, hash, confirmations) })
  }

  const sorted = sortByAddress(signed)
  return concat(sorted.map((s) => s.sig)) as Hex
}

/**
 * Fetch the Safe transactions of an account on each of the passed chains.
 * `minNonce` is the smallest nonce we are still waiting on for that chain -
 * transactions below it can no longer execute, so the API does not have to
 * return them.
 */
export async function fetchExecutedTransactions(
  safeAddr: Hex,
  chains: { chainId: bigint; minNonce: number }[]
): Promise<
  {
    safeTxnHash: Hex
    nonce: string
    transactionHash?: Hex
    confirmations?: SafeMultisigConfirmationResponse[]
  }[]
> {
  const results: {
    safeTxnHash: Hex
    nonce: string
    transactionHash?: Hex
    confirmations?: SafeMultisigConfirmationResponse[]
  }[] = []
  const pages = paginate(chains, 3)

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!
    // we're allowed a max of 5 req to the API per second so we
    // have to be careful - making 3 at a time from here
    const responses = await Promise.all(
      page.map(async ({ chainId, minNonce }) => {
        const apiKit = getApiKit(chainId)
        // @TODO this method can be used to get safe tx history
        // @TODO make rate limit tracking for the whole library
        // Cut the response size down: the account may have a long history, but
        // everything below minNonce can no longer execute, so it cannot resolve a
        // request we are waiting on. The double underscore is the filter syntax of
        // the Safe Transaction Service, not a typo
        const res = await apiKit
          .getMultisigTransactions(safeAddr, {
            ordering: 'nonce',
            nonce__gte: minNonce
          })
          .catch((error: unknown) => {
            console.log(`failed to call getMultisigTransactions on ${chainId}`, error)
            return null
          })
        return res
      })
    )
    responses
      .filter((response): response is SafeMultisigTransactionListResponse => response !== null)
      .forEach(({ results: txns }) => {
        txns.forEach((tx) => {
          if (tx.transactionHash) {
            results.push({
              safeTxnHash: tx.safeTxHash as Hex,
              transactionHash: tx.transactionHash as Hex,
              nonce: tx.nonce
            })
          } else {
            results.push({
              safeTxnHash: tx.safeTxHash as Hex,
              nonce: tx.nonce,
              confirmations: tx.confirmations
            })
          }
        })
      })
    // no need to throttle after the last page, nothing follows it
    if (i + 1 < pages.length) await wait(1100)
  }

  return results
}

export async function getNonce(safeAddr: string, provider: RPCProvider): Promise<bigint> {
  const safeInterface = new Contract(safeAddr, SafeAbi, provider) as any
  return safeInterface.nonce()
}
