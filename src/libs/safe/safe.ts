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
  zeroPadValue
} from 'ethers'

import { SignTypedDataVersion, TypedDataUtils } from '@metamask/eth-sig-util'
import SafeApiKit from '@safe-global/api-kit'

import SafeAbi from '../../../contracts/compiled/Safe.json'
import { Hex } from '../../interfaces/hex'
import { RPCProvider } from '../../interfaces/provider'
import { SafeTx } from '../../interfaces/safe'
import { CallsUserRequest, TypedMessageUserRequest } from '../../interfaces/userRequest'
import wait from '../../utils/wait'
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
      `failed to call proxyCreationCode on Safe factory with addr: ${creation.factoryAddress}`
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
    console.error('failed to decode the Safe setup data')
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
  const msg = await apiKit.getMessage(messageHash).catch((e) => null)
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

export async function getTransaction(
  chainId: bigint,
  safeTxnHash: Hex
): Promise<SafeMultisigTransactionResponse> {
  const apiKit = getApiKit(chainId)
  return apiKit.getTransaction(safeTxnHash)
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
        calls = decodeMultiSend(multiSendCall[0]).map((call) => ({
          to: call.to,
          value: call.value,
          data: call.data
        }))
      } catch (e) {
        // this just means it's not a batch
        calls = [{ to: txn.to, value: BigInt(txn.value), data: txn.data || '0x' }]
      }

      const signature = txn.confirmations
        ? (concat(txn.confirmations?.map((c) => c.signature)) as Hex)
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

export async function fetchExecutedTransactions(
  txns: { chainId: bigint; safeTxnHash: Hex }[]
): Promise<
  {
    safeTxnHash: Hex
    nonce: string
    transactionHash?: Hex
    confirmations?: SafeMultisigConfirmationResponse[]
  }[]
> {
  let promises = []
  const results: {
    safeTxnHash: Hex
    nonce: string
    transactionHash?: Hex
    confirmations?: SafeMultisigConfirmationResponse[]
  }[] = []

  for (let i = 0; i < txns.length; i++) {
    const txn = txns[i]!
    promises.push(getTransaction(txn.chainId, txn.safeTxnHash))

    // we're allowed a max of 5 req to the API per second so we
    // have to be careful - making 3 at a time from here
    if ((i + 1) % 3 === 0 || i + 1 === txns.length) {
      const responses = await Promise.all(promises)
      responses.forEach((r) => {
        if (r.transactionHash) {
          results.push({
            safeTxnHash: r.safeTxHash as Hex,
            transactionHash: r.transactionHash as Hex,
            nonce: r.nonce
          })
        } else {
          results.push({
            safeTxnHash: r.safeTxHash as Hex,
            nonce: r.nonce,
            confirmations: r.confirmations
          })
        }
      })
      await wait(1100)
      promises = []
    }
  }

  return results
}

export async function getNonce(safeAddr: string, provider: RPCProvider): Promise<bigint> {
  const safeInterface = new Contract(safeAddr, SafeAbi, provider) as any
  return safeInterface.nonce()
}
