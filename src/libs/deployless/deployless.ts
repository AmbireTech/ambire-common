import { Interface, concat, AbiCoder, Provider, JsonRpcProvider, getBytes } from 'ethers'
import assert from 'assert'
import DeploylessCompiled from '../../../contracts/compiled/Deployless.json'

// this is a magic contract that is constructed like `constructor(bytes memory contractBytecode, bytes memory data)` and returns the result from the call
// compiled from relayer:a7ea373559d8c419577ac05527bd37fbee8856ae/src/velcro-v3/contracts/Deployless.sol with solc 0.8.17
const deploylessProxyBin = DeploylessCompiled.bin
// This is another magic contract that can return the contract code at an address; this is not the deploy bytecode but rather the contract code itself
// see https://gist.github.com/Ivshti/fbcc37c0a8b88d6e51bb30db57f3d50e
const codeOfContractCode = DeploylessCompiled.binRuntime
const codeOfContractAbi = DeploylessCompiled.abi
// The custom error that both these contracts will raise in case the deploy process of the contract goes wrong
// error DeployFailed();
const deployErrorSig = '0xb4f54111'
// Signature of Error(string)
const errorSig = '0x08c379a0'
// Signature of Panic(uint256)
const panicSig = '0x4e487b71'

// any made up addr would work
const arbitraryAddr = '0x0000000000000000000000000000000000696969'
const abiCoder = new AbiCoder()

export enum DeploylessMode {
  Detect,
  ProxyContract,
  StateOverride
}
export type CallOptions = {
  mode: DeploylessMode
  // Note: some RPCs don't seem to like numbers, we can use hex strings for them
  blockTag: string | number
  from?: string
  gasPrice?: string
  gasLimit?: string
}
const defaultOptions: CallOptions = {
  mode: DeploylessMode.Detect,
  blockTag: 'latest',
  from: undefined
}

export class Deployless {
  private iface: Interface
  // the contract deploy (constructor) code: this is the code that tjhe solidity compiler outputs
  private contractBytecode: string
  private provider: JsonRpcProvider | Provider
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
    abi: any,
    code: string,
    codeAtRuntime?: string
  ) {
    assert.ok(code.startsWith('0x'), 'contract code must start with 0x')
    this.contractBytecode = code
    this.provider = provider
    this.iface = new Interface(abi)
    if (codeAtRuntime !== undefined) {
      assert.ok(codeAtRuntime.startsWith('0x'), 'contract code (runtime) must start with 0x')
      this.stateOverrideSupported = true
      this.contractRuntimeCode = codeAtRuntime
    }
  }

  // this will detect whether the provider supports state override and also retrieve the actual code of the contract we are using
  private async detectStateOverride(): Promise<void> {
    if (!(this.provider instanceof JsonRpcProvider)) {
      throw new Error(
        'state override mode (or auto-detect) not available unless you use JsonRpcProvider'
      )
    }
    const codeOfIface = new Interface(codeOfContractAbi)
    const code = await mapError(
      (this.provider as JsonRpcProvider).send('eth_call', [
        {
          to: arbitraryAddr,
          data: codeOfIface.encodeFunctionData('codeOf', [this.contractBytecode])
        },
        'latest',
        { [arbitraryAddr]: { code: codeOfContractCode } }
      ])
    )
    // any response bigger than 0x is sufficient to know that state override worked
    this.stateOverrideSupported = code.length > 2
    this.contractRuntimeCode = mapResponse(code)
  }

  async call(methodName: string, args: any[], opts: Partial<CallOptions> = {}): Promise<any> {
    opts = { ...defaultOptions, ...opts }
    const forceProxy = opts.mode === DeploylessMode.ProxyContract

    // First, start by detecting which modes are available, unless we're forcing the proxy mode
    // if we use state override, we do need detection to run still so it can populate contractRuntimeCode
    if (!this.detectionPromise && !forceProxy && this.contractRuntimeCode === undefined) {
      this.detectionPromise = this.detectStateOverride()
    }
    await this.detectionPromise

    if (opts.mode === DeploylessMode.StateOverride && !this.stateOverrideSupported) {
      // @TODO test this case
      throw new Error('state override requested but not supported')
    }

    const callData = this.iface.encodeFunctionData(methodName, args)
    const callPromise =
      !!this.stateOverrideSupported && !forceProxy
        ? (this.provider as JsonRpcProvider).send('eth_call', [
            {
              to: arbitraryAddr,
              data: callData,
              from: opts.from,
              gasPrice: opts?.gasPrice,
              gas: opts?.gasLimit
            },
            opts.blockTag,
            { [arbitraryAddr]: { code: this.contractRuntimeCode } }
          ])
        : this.provider.call({
            blockTag: opts.blockTag,
            from: opts.from,
            gasPrice: opts?.gasPrice,
            gasLimit: opts?.gasLimit,
            data: checkDataSize(
              concat([
                deploylessProxyBin,
                abiCoder.encode(['bytes', 'bytes'], [this.contractBytecode, callData])
              ])
            )
          })
    const returnDataRaw = mapResponse(await mapError(callPromise))
    return this.iface.decodeFunctionResult(methodName, returnDataRaw)
  }
}

export function fromDescriptor(
  provider: JsonRpcProvider | Provider,
  desc: { abi: any, bin: string, binRuntime: string },
  supportStateOverride: boolean
): Deployless {
  return new Deployless(provider, desc.abi, desc.bin, supportStateOverride ? desc.binRuntime : undefined)
}

async function mapError(callPromise: Promise<string>): Promise<string> {
  try {
    return await callPromise
  } catch (e: any) {
    // ethers v5 provider: e.error.data is usually our eth_call output in case of execution reverted
    if (e.error && e.error.data) return e.error.data
    // ethers v5 provider: unwrap the wrapping that ethers adds to this type of error in case of provider.call
    if (e.code === 'CALL_EXCEPTION' && e.error) throw e.error
    // ethers v6 provider: wrapping the error in case of execution reverted
    if (e.code === 'CALL_EXCEPTION' && e.data) return e.data
    throw e
  }
}

function mapResponse(data: string): string {
  if (data === deployErrorSig) throw new Error('contract deploy failed')
  const err = parseErr(data)
  if (err) throw err
  return data
}

export function parseErr(data: string): string | null {
  const dataNoPrefix = data.slice(10)
  if (data.startsWith(panicSig)) {
    // https://docs.soliditylang.org/en/v0.8.11/control-structures.html#panic-via-assert-and-error-via-require
    const num = parseInt('0x' + dataNoPrefix)
    if (num === 0x00) return 'generic compiler error'
    if (num === 0x01) return 'solidity assert error'
    if (num === 0x11) return 'arithmetic error'
    if (num === 0x12) return 'division by zero'
    return `panic error: 0x${num.toString(16)}`
  }
  if (data.startsWith(errorSig)) {
    try {
      return abiCoder.decode(['string'], '0x' + dataNoPrefix)[0]
    } catch (e: any) {
      if (e.code === 'BUFFER_OVERRUN' || e.code === 'NUMERIC_FAULT') return dataNoPrefix
      else throw e
    }
  }
  return null
}

function checkDataSize(data: string): string {
  if (getBytes(data).length >= 24576)
    throw new Error('24kb call data size limit reached, use StateOverride mode')
  return data
}
