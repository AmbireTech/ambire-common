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
  solidityPacked,
  toBeHex,
  toUtf8Bytes,
  ZeroAddress,
  zeroPadValue
} from 'ethers'

import { SignTypedDataVersion, TypedDataUtils } from '@metamask/eth-sig-util'
import SafeApiKit, {
  ProposeTransactionProps,
  SafeCreationInfoResponse,
  SafeInfoResponse,
  SafeMessage,
  SafeMessageListResponse,
  SafeMultisigTransactionListResponse
} from '@safe-global/api-kit'
import {
  EIP712TypedData,
  SafeMultisigConfirmationResponse,
  SafeMultisigTransactionResponse
} from '@safe-global/types-kit'

import SafeAbi from '../../../contracts/compiled/Safe.json'
import { execTransactionAbi, multiSendAddr, safeNullOwner } from '../../consts/safe'
import { AccountOnchainState, SafeAccountCreation } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
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

const SAFE_CALL_OPERATION = 0
const SAFE_DELEGATE_CALL_OPERATION = 1

export interface SafeResults {
  [chainId: string]: {
    txns: SafeMultisigTransactionResponse[]
    messages: ExtendedSafeMessage[]
  }
}

export type SafeImportInfo = SafeAccountCreation & {
  address: Hex
  deployedOn: bigint[]
  owners: Hex[]
  requiresModules: boolean
}

export async function getSafeImportInfo({
  safeAddr,
  chainId,
  deployedOn = [chainId]
}: {
  safeAddr: string
  chainId: bigint
  deployedOn?: bigint[]
}): Promise<SafeImportInfo | null> {
  const apiKit = new SafeApiKit({
    chainId,
    apiKey: process.env.SAFE_API_KEY
  })
  const [safeInfo, safeCreationInfo]: [SafeInfoResponse | Error, SafeCreationInfoResponse | Error] =
    await Promise.all([
      apiKit.getSafeInfo(safeAddr).catch((e) => e),
      apiKit.getSafeCreationInfo(safeAddr).catch((e) => e)
    ])

  if (safeInfo instanceof Error || safeCreationInfo instanceof Error) return null

  return {
    version: safeInfo.version,
    address: safeInfo.address as Hex,
    owners: safeInfo.owners as Hex[],
    deployedOn,
    factoryAddr: safeCreationInfo.factoryAddress as Hex,
    singleton: safeCreationInfo.singleton as Hex,
    saltNonce: safeCreationInfo.saltNonce
      ? (toBeHex(BigInt(safeCreationInfo.saltNonce), 32) as Hex)
      : (toBeHex(0, 32) as Hex),
    setupData: safeCreationInfo.setupData as Hex,
    requiresModules: safeInfo.owners.length === 1 && safeInfo.owners[0] === safeNullOwner
  }
}

export async function scanSafesByOwners({
  ownerAddrs,
  chainIds
}: {
  ownerAddrs: string[]
  chainIds: bigint[]
}): Promise<{
  safeInfos: SafeImportInfo[]
  errorMessage?: string
}> {
  const safeAddressesByChainId = new Map<string, Set<bigint>>()
  const scanErrors: string[] = []
  const ownerScanRequests = ownerAddrs.flatMap((ownerAddr) =>
    chainIds.map((chainId) => ({ ownerAddr, chainId }))
  )
  let ownerScanPromises = []

  for (let i = 0; i < ownerScanRequests.length; i++) {
    const { ownerAddr, chainId } = ownerScanRequests[i]!
    const apiKit = new SafeApiKit({
      chainId,
      apiKey: process.env.SAFE_API_KEY
    })

    ownerScanPromises.push(
      apiKit.getSafesByOwner(ownerAddr).then((response) => ({
        response,
        chainId
      }))
    )

    if ((i + 1) % 3 === 0 || i + 1 === ownerScanRequests.length) {
      const responses = await Promise.all(
        ownerScanPromises.map((promise) => promise.catch((e) => e))
      )
      responses.forEach((result) => {
        if (result instanceof Error) {
          scanErrors.push(result.message)
          return
        }

        result.response.safes.forEach((safeAddr: string) => {
          const checksummedSafeAddr = getAddress(safeAddr)
          const safeChainIds = safeAddressesByChainId.get(checksummedSafeAddr) || new Set<bigint>()
          safeChainIds.add(result.chainId)
          safeAddressesByChainId.set(checksummedSafeAddr, safeChainIds)
        })
      })
      await wait(1100)
      ownerScanPromises = []
    }
  }

  const safeInfos: SafeImportInfo[] = []
  const safeInfoRequests = Array.from(safeAddressesByChainId.entries())
  let safeInfoPromises = []

  for (let i = 0; i < safeInfoRequests.length; i++) {
    const [safeAddr, deployedOn] = safeInfoRequests[i]!
    const firstChainId = Array.from(deployedOn)[0]!

    safeInfoPromises.push(
      getSafeImportInfo({
        safeAddr,
        chainId: firstChainId,
        deployedOn: Array.from(deployedOn)
      })
    )

    if ((i + 1) % 2 === 0 || i + 1 === safeInfoRequests.length) {
      const responses = await Promise.all(safeInfoPromises)
      safeInfos.push(...responses.filter((safeInfo): safeInfo is SafeImportInfo => !!safeInfo))
      await wait(1100)
      safeInfoPromises = []
    }
  }

  return {
    safeInfos,
    errorMessage: scanErrors.length
      ? `The attempt to discover Safe accounts failed for some networks. Error details: <${[
          ...new Set(scanErrors)
        ].join('; ')}>`
      : undefined
  }
}

export function encodeCalls(op: AccountOp): {
  to: Hex
  value: bigint
  data: Hex
  operation: number
} {
  const calls = getSignableCalls(op)

  if (calls.length === 1) {
    const singleCall = calls[0]!
    return {
      to: singleCall[0] as Hex,
      value: BigInt(singleCall[1]),
      data: singleCall[2] as Hex,
      operation: SAFE_CALL_OPERATION
    }
  }

  const multiSendData = new Interface(multiCallAbi).encodeFunctionData('multiSend', [
    concat(
      calls.map((call) => {
        return solidityPacked(
          ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
          [SAFE_CALL_OPERATION, call[0], BigInt(call[1]), BigInt(getBytes(call[2]).length), call[2]]
        )
      })
    )
  ])

  return {
    to: multiSendAddr as Hex,
    value: 0n,
    data: multiSendData as Hex,
    operation: SAFE_DELEGATE_CALL_OPERATION
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
 * Construct a Safe txn for signing
 */
export function getSafeTxn(op: AccountOp, state: AccountOnchainState): SafeTx {
  // todo: we're blindly trusting the returned txn from Safe Global, is this OK?
  if (op.safeTx) {
    return {
      to: op.safeTx.to as Hex,
      value: toBeHex(op.safeTx.value) as Hex,
      data: op.safeTx.data ? (op.safeTx.data as Hex) : '0x',
      operation: op.safeTx.operation,
      safeTxGas: toBeHex(op.safeTx.safeTxGas) as Hex,
      baseGas: toBeHex(op.safeTx.baseGas) as Hex,
      gasPrice: toBeHex(op.safeTx.gasPrice) as Hex,
      gasToken: op.safeTx.gasToken as Hex,
      refundReceiver: op.safeTx.refundReceiver ? (op.safeTx.refundReceiver as Hex) : '0x',
      nonce: toBeHex(op.safeTx.nonce) as Hex
    }
  }

  const coder = new AbiCoder()
  const { to, value, data, operation } = encodeCalls(op)

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
    message: normalizeSafeGlobalMessage(message),
    signature
  })
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
  const apiKit = new SafeApiKit({
    chainId,
    apiKey: process.env.SAFE_API_KEY
  })

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

export function decodeMultiSend(transactionsHex: string) {
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
    signatures: Hex[]
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
            message.messageHash,
            message.confirmations
          ),
          created: new Date(message.created).getTime(),
          signatures: message.confirmations.map((c) => c.signature) as Hex[]
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

export async function getNonce(safeAddr: string, provider: RPCProvider): Promise<bigint> {
  const safeInterface = new Contract(safeAddr, SafeAbi, provider) as any
  return safeInterface.nonce()
}
