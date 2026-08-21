import {
  AbiCoder,
  concat,
  Contract,
  getAddress,
  getCreate2Address,
  hexlify,
  Interface,
  keccak256,
  recoverAddress,
  toBeHex,
  toUtf8Bytes,
  ZeroAddress,
  zeroPadValue
} from 'ethers'

import { SignTypedDataVersion, TypedDataUtils } from '@metamask/eth-sig-util'
import SafeApiKit from '@safe-global/api-kit'

import SafeAbi from '../../../contracts/compiled/Safe.json'
import { SAFE_API_TIMEOUT_MS } from '../../consts/safe'
import { Hex } from '../../interfaces/hex'
import { RPCProvider } from '../../interfaces/provider'
import { SafeAccountByOwner, SafeTx } from '../../interfaces/safe'
import { CallsUserRequest, TypedMessageUserRequest } from '../../interfaces/userRequest'
import { paginate } from '../../utils/paginate'
import wait from '../../utils/wait'
import { withTimeout } from '../../utils/with-timeout'
import { adaptTypedMessageForMetaMaskSigUtil } from '../signMessage/signMessage'
import { decodeMultiSend, multiCallAbi, parseSafeMessageOrigin } from './helpers'

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

function getTxServiceUrl(chainId: bigint) {
  if (chainId === 8217n) return 'https://api.safe.global/tx-service/kaia/api'
  if (chainId === 4663n) return 'https://api.safe.global/tx-service/robinhood/api'
  return undefined
}

export function getApiKit(chainId: bigint) {
  return new SafeApiKit({
    chainId,
    apiKey: process.env.SAFE_API_KEY,
    txServiceUrl: getTxServiceUrl(chainId)
  })
}

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
              : (toBeHex(0, 32) as Hex),
            version: safeInfo.version
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
  const salt = keccak256(
    concat([keccak256(creation.setupData), zeroPadValue(toBeHex(creation.saltNonce || 0), 32)])
  )
  const factoryAbi = ['function proxyCreationCode() view returns (bytes)']
  const factory = new Contract(creation.factoryAddress, factoryAbi, provider)
  let proxyCreationCode
  try {
    proxyCreationCode = await (factory as any).proxyCreationCode()
  } catch (e) {
    console.error(
      `failed to call proxyCreationCode on Safe factory with addr: ${creation.factoryAddress}`,
      e
    )
    return null
  }
  const abiCoder = new AbiCoder()
  const bytecode = concat([
    proxyCreationCode,
    abiCoder.encode(['address'], [creation.singleton])
  ]) as Hex
  return getCreate2Address(creation.factoryAddress, salt, keccak256(bytecode)) as Hex
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
      let isBatch = false
      try {
        // try to decode the data to check if it's a batch
        // if it is, use it; otherwise, construct a single call reqx
        const multisendInterface = new Interface(multiCallAbi)
        const multiSendCall = multisendInterface.decodeFunctionData('multiSend', txn.data!)
        isBatch = true
        calls = decodeMultiSend(multiSendCall[0]).map((call) => ({
          to: call.to,
          value: call.value,
          data: call.data
        }))
      } catch {
        // this just means it's not a batch
        calls = [{ to: txn.to, value: BigInt(txn.value), data: txn.data || '0x' }]
      }

      const call = calls.length === 1 ? calls[0] : undefined
      const isOnchainSafeRejection =
        !isBatch &&
        !!call?.to &&
        txn.operation === 0 &&
        (call.to.toLowerCase() === ZeroAddress ||
          call.to.toLowerCase() === safeAddr.toLowerCase()) &&
        call.value === 0n &&
        call.data === '0x'

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
              ...(isOnchainSafeRejection && { isOnchainSafeRejection: true }),
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
