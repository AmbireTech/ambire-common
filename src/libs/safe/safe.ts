import {
  AbiCoder,
  concat,
  Contract,
  getAddress,
  getBytes,
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
import SafeApiKit, {
  ProposeTransactionProps,
  SafeCreationInfoResponse,
  SafeMessage,
  SafeMessageListResponse,
  SafeMultisigTransactionListResponse
} from '@safe-global/api-kit'
import {
  EIP712TypedData,
  SafeMultisigConfirmationResponse,
  SafeMultisigTransactionResponse
} from '@safe-global/types-kit'

import { execTransactionAbi, multiSendAddr } from '../../consts/safe'
import { AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { Key } from '../../interfaces/keystore'
import { RPCProvider } from '../../interfaces/provider'
import { SafeTx } from '../../interfaces/safe'
import { CallsUserRequest, TypedMessageUserRequest } from '../../interfaces/userRequest'
import wait from '../../utils/wait'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { adaptTypedMessageForMetaMaskSigUtil } from '../signMessage/signMessage'

const multiCallAbi = [
  { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
  {
    inputs: [{ internalType: 'bytes', name: 'transactions', type: 'bytes' }],
    name: 'multiSend',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  }
]

export type ExtendedSafeMessage = SafeMessage & { isConfirmed: boolean }

export interface SafeResults {
  [chainId: string]: {
    txns: SafeMultisigTransactionResponse[]
    messages: ExtendedSafeMessage[]
  }
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
      `failed to call proxyCreationCode on safe factory with addr: ${creation.factoryAddress}`
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
 * to fetch the initial owners of the safe so that we could put them
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
    console.error('failed to decode the safe setup data')
    return []
  }

  return Object.keys(decoded[0]).map((key) => decoded[0][key])
}

/**
 * Construct a safe txn for signing
 */
export function getSafeTxn(op: AccountOp, state: AccountOnchainState): SafeTx {
  // todo: we're blindly trusting the returned txn from safe global, is this OK?
  if (op.safeTx) {
    return {
      to: op.safeTx.to as Hex,
      value: toBeHex(op.safeTx.value) as Hex,
      data: op.safeTx.data as Hex,
      operation: op.safeTx.operation,
      safeTxGas: toBeHex(op.safeTx.safeTxGas) as Hex,
      baseGas: toBeHex(op.safeTx.baseGas) as Hex,
      gasPrice: toBeHex(op.safeTx.gasPrice) as Hex,
      gasToken: op.safeTx.gasToken as Hex,
      refundReceiver: op.safeTx.refundReceiver as Hex,
      nonce: toBeHex(op.safeTx.nonce) as Hex
    }
  }

  const coder = new AbiCoder()
  const calls = getSignableCalls(op)

  let to
  let value
  let data
  let operation

  if (calls.length === 1) {
    const singleCall = calls[0]!
    to = singleCall[0]
    value = BigInt(singleCall[1])
    data = singleCall[2]
    operation = 0 // static call
  } else {
    const multisendInterface = new Interface(multiCallAbi)
    const multiSendCalls = multisendInterface.encodeFunctionData('multiSend', [
      concat(
        calls.map((call) => {
          return concat([
            '0x00',
            zeroPadValue(call[0], 20),
            zeroPadValue(toBeHex(call[1]), 32),
            zeroPadValue(toBeHex(call[2].substring(2).length / 2), 32),
            call[2]
          ])
        })
      )
    ])
    to = multiSendAddr
    value = 0n
    data = multiSendCalls
    operation = 1 // delegate call
  }

  return {
    to: to as Hex,
    value: toBeHex(value) as Hex,
    data: data as Hex,
    operation,
    safeTxGas: toBeHex(0) as Hex,
    baseGas: toBeHex(0) as Hex,
    gasPrice: toBeHex(0) as Hex,
    gasToken: ZeroAddress as Hex,
    refundReceiver: ZeroAddress as Hex,
    nonce: toBeHex(op.nonce || state.nonce || 0n) as Hex
  }
}

export function getSafeBroadcastTxn(
  op: AccountOp,
  state: AccountOnchainState
): { to: Hex; value: bigint; data: Hex } {
  const exec = new Interface(execTransactionAbi)
  const safeTxn = getSafeTxn(op, state)
  return {
    to: op.accountAddr as Hex,
    value: 0n,
    data: exec.encodeFunctionData('execTransaction', [
      safeTxn.to,
      safeTxn.value,
      safeTxn.data,
      safeTxn.operation,
      safeTxn.safeTxGas,
      safeTxn.baseGas,
      safeTxn.gasPrice,
      safeTxn.gasToken,
      safeTxn.refundReceiver,
      op.signature
    ]) as Hex
  }
}

/**
 * In safe, the signatures need to be in order, starting with
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

/**
 * Get internal keys first
 */
export function getDefaultOwners(
  keys: Key[],
  threshold: number,
  alreadySignedAddrs: string[] = []
): Key[] {
  const notSinged = keys.filter((k) => !alreadySignedAddrs.includes(k.addr))

  // we do not set default signers when:
  // - we have more than two hw types that are left so sign
  // - we don't have enough internal keys to sign the remaining
  // reason for this is that we cannot select the hardware wallet automatically,
  // the user needs to do it manually
  const internal = notSinged.filter((k) => k.type === 'internal')
  const hwTypes = [...new Set(notSinged.filter((k) => k.type !== 'internal').map((k) => k.type))]
  const leftToSign = threshold - alreadySignedAddrs.length
  if (hwTypes.length > 1 && internal.length < leftToSign) return []

  return notSinged
    .sort((a, b) => {
      const isAInternal = a.type === 'internal'
      const isBInternal = b.type === 'internal'
      return isAInternal && !isBInternal ? -1 : !isAInternal && isBInternal ? 1 : 0
    })
    .slice(0, leftToSign)
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
  const apiKit = new SafeApiKit({
    chainId,
    apiKey: process.env.SAFE_API_KEY
  })

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
  const apiKit = new SafeApiKit({
    chainId,
    apiKey: process.env.SAFE_API_KEY
  })
  return apiKit.confirmTransaction(safeTxHash, ownerSig)
}

export async function addMessage(
  chainId: bigint,
  safeAddress: Hex,
  message: string | EIP712TypedData,
  signature: string
) {
  const apiKit = new SafeApiKit({
    chainId,
    apiKey: process.env.SAFE_API_KEY
  })
  return apiKit.addMessage(safeAddress, {
    message,
    signature
  })
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
  const apiKit = new SafeApiKit({
    chainId: chainId,
    apiKey: process.env.SAFE_API_KEY
  })
  const msg = await apiKit.getMessage(messageHash).catch((e) => null)
  if (!msg) return null
  return {
    ...msg,
    isConfirmed: msg.confirmations.length >= threshold
  }
}

export async function addMessageSignature(chainId: bigint, hash: string, signature: string) {
  const apiKit = new SafeApiKit({
    chainId,
    apiKey: process.env.SAFE_API_KEY
  })
  return apiKit.addMessageSignature(hash, signature)
}

export async function getPendingTransactions(
  chainId: bigint,
  safeAddress: Hex
): Promise<SafeMultisigTransactionListResponse & { chainId: bigint; type: string }> {
  const apiKit = new SafeApiKit({
    chainId,
    apiKey: process.env.SAFE_API_KEY
  })

  const response = await apiKit.getMultisigTransactions(safeAddress, {
    executed: false,
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
  const apiKit = new SafeApiKit({
    chainId,
    apiKey: process.env.SAFE_API_KEY
  })

  const response = await apiKit.getMessages(safeAddress, {
    ordering: '-created',
    limit: 15
  })
  return { ...response, chainId, type: 'message' }
}

export async function getTransaction(
  chainId: bigint,
  safeTxnHash: Hex
): Promise<SafeMultisigTransactionResponse> {
  const apiKit = new SafeApiKit({
    chainId,
    apiKey: process.env.SAFE_API_KEY
  })

  return apiKit.getTransaction(safeTxnHash)
}

export async function fetchAllPending(
  networks: { chainId: bigint; threshold: number }[],
  safeAddr: Hex
): Promise<SafeResults | null> {
  let promises = []
  const results: SafeResults = {}
  for (let i = 0; i < networks.length; i++) {
    const network = networks[i]!
    promises.push(getPendingTransactions(network.chainId, safeAddr))
    promises.push(getLatestMessages(network.chainId, safeAddr))

    // when we assemble 4 promises, we make 4 requests to the API,
    // take the results and wait an additional second.
    // this is because we're allowed 5 requests per second
    if (promises.length === 4 || i + 1 === networks.length) {
      const responses = await Promise.all(promises)
      responses.forEach((r) => {
        if (!results[r.chainId.toString()])
          results[r.chainId.toString()] = { txns: [], messages: [] }

        if (r.type === 'txn')
          results[r.chainId.toString()]!.txns = r.results as SafeMultisigTransactionResponse[]
        else
          results[r.chainId.toString()]!.messages = r.results.map((r) => {
            return { ...r, isConfirmed: (r.confirmations?.length || 0) >= network.threshold }
          }) as ExtendedSafeMessage[]
      })
      await wait(1000)
      promises = []
    }
  }

  return results
}

function decodeMultiSend(transactionsHex: string) {
  const bytes = getBytes(transactionsHex)
  let i = 0
  const results = []

  while (i < bytes.length) {
    const operation = bytes[i]
    i += 1

    const to = hexlify(bytes.slice(i, i + 20))
    i += 20

    const value = BigInt(hexlify(bytes.slice(i, i + 32)))
    i += 32

    const dataLength = Number(BigInt(hexlify(bytes.slice(i, i + 32))))
    i += 32

    const data = hexlify(bytes.slice(i, i + dataLength))
    i += dataLength

    results.push({
      operation,
      to,
      value,
      data
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
            message.messageHash
          ),
          created: new Date(message.created).getTime()
        },
        isConfirmed: !!message.isConfirmed
      })
    })
  })

  return userRequests
}

// the signature is 130 x number_of_sigs + 2 (0x) symbols long
// so we cut the hex (0x) from the beginning
// then take each sig (substring(0, 130)) and recover the address
// finally, we update everything
export function getAlreadySignedOwners(signature: string, hash: string): string[] {
  const signatures = signature.substring(2)
  const signed = []
  for (let i = 0; i < signatures.length; i += 130) {
    const sig = `0x${signatures.substring(i, i + 130)}`
    const owner = recoverAddress(hash, sig)
    signed.push(owner)
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

export function sortSigs(signatures: Hex[], hash: string): Hex {
  const signed: { sig: string; addr: string }[] = []

  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i]!
    const owner = recoverAddress(hash, sig)
    signed.push({ sig, addr: owner })
  }

  const sorted = sortByAddress(signed)
  return concat(sorted.map((s) => s.sig)) as Hex
}

/**
 * Safe requests may have multiple "call" ones with the same nonce
 */
export function getSameNonceRequests(requests: CallsUserRequest[]) {
  return requests.reduce((acc: { [nonce: string]: CallsUserRequest[] }, r) => {
    const key = r.signAccountOp.accountOp.nonce?.toString() || '0'

    if (!acc[key]) {
      acc[key] = []
    }

    acc[key].push(r)
    return acc
  }, {})
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
