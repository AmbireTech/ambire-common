import assert from 'assert'
import { JsonRpcProvider, Provider } from 'ethers'
import {
  concat,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  numberToHex
} from 'viem'

import DeploylessCompiled from '../../../contracts/compiled/Deployless.json'
import { ProviderError } from '../../classes/ProviderError'

// this is a magic contract that is constructed like `constructor(bytes memory contractBytecode, bytes memory data)` and returns the result from the call
// compiled from relayer:a7ea373559d8c419577ac05527bd37fbee8856ae/src/velcro-v3/contracts/Deployless.sol with solc 0.8.17
const deploylessProxyBin = DeploylessCompiled.bin
// This is another magic contract that can return the contract code at an address; this is not the deploy bytecode but rather the contract code itself
// see https://gist.github.com/Ivshti/fbcc37c0a8b88d6e51bb30db57f3d50e
const codeOfContractCode =
  '0x608060405234801561001057600080fd5b506004361061002b5760003560e01c80631e05758f14610030575b600080fd5b61004a60048036038101906100459190610248565b61004c565b005b60008151602083016000f0905060008173ffffffffffffffffffffffffffffffffffffffff163b036100aa576040517fb4f5411100000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b60008173ffffffffffffffffffffffffffffffffffffffff16803b806020016040519081016040528181526000908060200190933c90506000815190508060208301f35b6000604051905090565b600080fd5b600080fd5b600080fd5b600080fd5b6000601f19601f8301169050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6101558261010c565b810181811067ffffffffffffffff821117156101745761017361011d565b5b80604052505050565b60006101876100ee565b9050610193828261014c565b919050565b600067ffffffffffffffff8211156101b3576101b261011d565b5b6101bc8261010c565b9050602081019050919050565b82818337600083830152505050565b60006101eb6101e684610198565b61017d565b90508281526020810184848401111561020757610206610107565b5b6102128482856101c9565b509392505050565b600082601f83011261022f5761022e610102565b5b813561023f8482602086016101d8565b91505092915050565b60006020828403121561025e5761025d6100f8565b5b600082013567ffffffffffffffff81111561027c5761027b6100fd565b5b6102888482850161021a565b9150509291505056fea2646970667358221220de4923c71abcedf68454c251a9becff7e8a4f8db4adee6fdb16d583f509c63bb64736f6c63430008120033'
const codeOfContractAbi = [
  {
    type: 'function',
    name: 'codeOf',
    stateMutability: 'view',
    inputs: [{ name: 'deployCode', type: 'bytes' }],
    outputs: []
  }
] as const

// any made up addr would work
const arbitraryAddr = '0x0000000000000000000000000000000000696969'
const HEX_PREFIX = '0x'

/**
 * Turns a decimal or hex amount into the no-leading-zeros hex quantity an RPC
 * expects. Throws with the field name when the amount is not a number at all.
 */
function toRpcQuantity(value: string, field: string): string {
  try {
    return numberToHex(BigInt(value))
  } catch (error) {
    throw new Error(`${field} is not a valid amount: ${value}`, { cause: error })
  }
}

export enum DeploylessMode {
  Detect,
  ProxyContract,
  StateOverride,
  // Predeployed mode calls an already deployed contract and must not use state overrides.
  Predeployed
}
export type CallOptions = {
  mode: DeploylessMode
  // Note: some RPCs don't seem to like numbers, we can use hex strings for them
  blockTag: string | number
  from?: string
  to?: string
  gasPrice?: string
  gasLimit?: string
  stateToOverride: object | null
}
/** The fields of an `eth_call` this library ever sets, before normalisation. */
type EthCallRequest = {
  to?: string
  from?: string
  gasPrice?: string
  gasLimit?: string
  data: string
}
const defaultOptions: CallOptions = {
  mode: DeploylessMode.Detect,
  blockTag: 'latest',
  from: undefined,
  to: undefined,
  stateToOverride: null
}

export class Deployless {
  private abi: any[]

  // the contract deploy (constructor) code: this is the code that tjhe solidity compiler outputs
  private contractBytecode: string

  private provider: JsonRpcProvider | Provider

  private isProviderInvictus: boolean = false

  private providerUrl: string = ''

  // We need to detect whether the provider supports state override
  private detectionPromise?: Promise<void>

  private stateOverrideSupported?: boolean

  // the code of the contract after it's actually deployed (or in our case, simulate-deployed)
  // see this: https://medium.com/coinmonks/the-difference-between-bytecode-and-deployed-bytecode-64594db723df
  private contractRuntimeCode?: string

  public get isLimitedAt24kbData() {
    return !this.stateOverrideSupported
  }

  constructor(
    provider: JsonRpcProvider | Provider,
    abi: any[],
    code: string,
    codeAtRuntime?: string
  ) {
    assert.ok(code.startsWith('0x'), 'contract code must start with 0x')
    assert.ok(
      !abi.includes((x: any) => x.type === 'constructor'),
      'contract cannot have a constructor, as it is not supported in state override mode'
    )
    assert.ok(!!provider, 'provider must be provided')
    this.contractBytecode = code
    this.provider = provider
    this.abi = abi

    if (provider && provider instanceof JsonRpcProvider) {
      this.providerUrl = provider._getConnection().url
      this.isProviderInvictus = this.providerUrl?.includes('invictus')
    }

    if (codeAtRuntime !== undefined) {
      assert.ok(codeAtRuntime.startsWith('0x'), 'contract code (runtime) must start with 0x')
      this.stateOverrideSupported = true
      this.contractRuntimeCode = codeAtRuntime
    }
  }

  /**
   * True when the provider talks JSON-RPC itself, so a call can be sent as the
   * RPC takes it instead of through ethers' request handling.
   */
  private get isJsonRpcProvider(): boolean {
    return (
      !!this.provider &&
      typeof (this.provider as JsonRpcProvider).send === 'function' &&
      typeof (this.provider as JsonRpcProvider)._send === 'function'
    )
  }

  // this will detect whether the provider supports state override and also retrieve the actual code of the contract we are using
  private async detectStateOverride(): Promise<void> {
    if (!this.isJsonRpcProvider) {
      throw new Error(
        'state override mode (or auto-detect) not available unless you use JsonRpcProvider'
      )
    }
    const code = await Deployless.handleResponse(
      (this.provider as JsonRpcProvider).send('eth_call', [
        {
          to: arbitraryAddr,
          data: encodeFunctionData({
            abi: codeOfContractAbi,
            functionName: 'codeOf',
            args: [this.contractBytecode as `0x${string}`]
          })
        },
        'latest',
        { [arbitraryAddr]: { code: codeOfContractCode } }
      ]),
      this.providerUrl
    )
    // any response bigger than 0x is sufficient to know that state override worked
    // the response would be just "0x" if state override doesn't work
    this.stateOverrideSupported = code.startsWith('0x') && code.length > 2
    this.contractRuntimeCode = code
  }

  private static async handleResponse(
    callPromise: Promise<string>,
    providerUrl: string
  ): Promise<string> {
    try {
      return await callPromise
    } catch (e: any) {
      throw new ProviderError({ originalError: e, providerUrl })
    }
  }

  private static checkDataSize(data: string): string {
    // Done this way instead of getBytes for performance
    if ((data.length - HEX_PREFIX.length) / 2 >= 24576)
      throw new Error(
        'Transaction cannot be sent because the 24kb call data size limit has been reached. Please use StateOverride mode instead.'
      )
    return data
  }

  /**
   * To be able to successfully pass a number as blockTag,
   * we need to turn it into a no-leading zeros hex.
   * This is the standard to make sure RPCs don't revert
   */
  private static normalizeRpcBlockTag(blockTag: string | number): string {
    return typeof blockTag === 'number' ? numberToHex(blockTag) : blockTag
  }

  /**
   * Sends `eth_call` straight to the RPC instead of through `provider.call`,
   * which re-hexlifies the already-valid calldata twice on its way there.
   * Deployless calldata is tens of KB, so skipping that is worth it.
   */
  private sendCall(request: EthCallRequest, blockTag: string): Promise<string> {
    if (!this.isJsonRpcProvider) return this.provider.call({ ...request, blockTag })

    // Set one by one rather than spread, because the RPC reads a field that is
    // present and undefined as a field that was given an invalid value, and
    // `getRpcTransaction` leaves those out too.
    const tx: Record<string, string> = { data: request.data }

    if (request.to !== undefined) tx.to = request.to
    if (request.from !== undefined) tx.from = request.from
    if (request.gasPrice !== undefined) tx.gasPrice = toRpcQuantity(request.gasPrice, 'tx.gasPrice')
    if (request.gasLimit !== undefined) tx.gas = toRpcQuantity(request.gasLimit, 'tx.gasLimit')

    return (this.provider as JsonRpcProvider).send('eth_call', [tx, blockTag])
  }

  private getCallPromise(callData: `0x${string}`, opts: CallOptions): Promise<string> {
    const blockTag = Deployless.normalizeRpcBlockTag(opts.blockTag)

    if (opts.mode === DeploylessMode.Predeployed) {
      if (!opts.to) throw new Error('Predeployed mode requires a deployed contract address')

      return this.sendCall(
        {
          from: opts.from,
          to: opts.to,
          gasPrice: opts?.gasPrice,
          gasLimit: opts?.gasLimit,
          data: callData
        },
        blockTag
      )
    }

    const toAddr = opts.to ?? arbitraryAddr
    if (!!this.stateOverrideSupported && opts.mode !== DeploylessMode.ProxyContract) {
      return (this.provider as JsonRpcProvider).send('eth_call', [
        {
          to: toAddr,
          data: callData,
          from: opts.from,
          gasPrice: opts?.gasPrice,
          gas: opts?.gasLimit
        },
        blockTag,
        {
          [toAddr]: { code: this.contractRuntimeCode },
          ...(opts.stateToOverride || {})
        }
      ])
    }

    return this.sendCall(
      {
        from: opts.from,
        gasPrice: opts?.gasPrice,
        gasLimit: opts?.gasLimit,
        data: Deployless.checkDataSize(
          concat([
            deploylessProxyBin as `0x${string}`,
            encodeAbiParameters(
              [{ type: 'bytes' }, { type: 'bytes' }],
              [this.contractBytecode as `0x${string}`, callData]
            )
          ])
        )
      },
      blockTag
    )
  }

  async call(methodName: string, args: any[], _opts: Partial<CallOptions> = {}): Promise<any> {
    const opts = { ...defaultOptions, ..._opts }
    const forceProxy = opts.mode === DeploylessMode.ProxyContract
    const forcePredeployed = opts.mode === DeploylessMode.Predeployed

    // First, start by detecting which modes are available, unless we're forcing the proxy mode
    // if we use state override, we do need detection to run still so it can populate contractRuntimeCode
    if (
      this.stateOverrideSupported &&
      !this.detectionPromise &&
      !forceProxy &&
      !forcePredeployed &&
      this.contractRuntimeCode === undefined
    ) {
      this.detectionPromise = this.detectStateOverride()
    }
    await this.detectionPromise

    if (opts.stateToOverride !== null && opts.mode !== DeploylessMode.StateOverride) {
      throw new Error('state override passed but not requested')
    }
    if (opts.mode === DeploylessMode.StateOverride && !this.stateOverrideSupported) {
      throw new Error(`${methodName}: state override requested but not supported`)
    }

    const callData = encodeFunctionData({
      abi: this.abi,
      functionName: methodName,
      args
    })

    const callPromise = this.getCallPromise(callData, opts)
    const timeoutMs =
      opts.mode === DeploylessMode.Predeployed ? 40000 : this.isProviderInvictus ? 15000 : 20000

    // The ethers' providers retry failed calls every 1 second, making numerous attempts before finally resolving the promise.
    // To prevent prolonged retries, we use Promise.race to set a timeout. This way, the callPromise will either resolve
    // or the timeout promise will reject, whichever occurs first.
    const returnDataRaw = await Deployless.handleResponse(
      Promise.race([
        callPromise,
        new Promise<string>((_resolve, reject) => {
          // Custom providers may take longer to respond, so we set a longer timeout for them.
          setTimeout(
            () =>
              reject(
                new Error(
                  `rpc-timeout. Rpc: ${this.isProviderInvictus ? this.providerUrl : 'custom'}`
                )
              ),
            timeoutMs
          )
        })
      ]),
      this.providerUrl
    )

    return decodeFunctionResult({
      abi: this.abi,
      functionName: methodName,
      data: returnDataRaw as `0x${string}`
    })
  }
}

export function fromDescriptor(
  provider: JsonRpcProvider | Provider,
  desc: { abi: any; bin: string; binRuntime: string },
  supportStateOverride: boolean
): Deployless {
  return new Deployless(
    provider,
    desc.abi,
    desc.bin,
    supportStateOverride ? desc.binRuntime : undefined
  )
}
