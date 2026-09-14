import { AbiCoder, Contract, Interface, toBeHex, ZeroAddress } from 'ethers'

import { generateUuid } from '@/utils/uuid'

import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import entryPointAbi from '../../../contracts/compiled/EntryPoint.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { AMBIRE_PAYMASTER, ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Account } from '../../interfaces/account'
import { Fetch } from '../../interfaces/fetch'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { GasSpeeds } from '../../services/bundlers/types'
import { failedPaymasters } from '../../services/paymaster/FailedPaymasters'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import { getFeeCall } from '../calls/calls'
import {
  AMBIRE_NETWORK_WIDE_SPONSORSHIP_POLICY,
  AMBIRE_SWAP_POLICY,
  getAmbireSponsorshipUrl,
  getPaymasterData,
  getPaymasterStubData
} from '../erc7677/erc7677'
import {
  PaymasterErrorReponse,
  PaymasterEstimationData,
  PaymasterService,
  PaymasterSuccessReponse
} from '../erc7677/types'
import { RelayerPaymasterError, SponsorshipPaymasterError } from '../errorDecoder/customErrors'
import { getHumanReadableBroadcastError } from '../errorHumanizer'
import { getFeeTokenForEstimate, getSigForCalculations } from '../estimate/estimateHelpers'
import { BundlerEstimateResult } from '../estimate/interfaces'
import { TokenResult } from '../portfolio'
import { relayerCall } from '../relayerCall/relayerCall'
import { UserOperation } from '../userOperation/types'
import { getCleanUserOp } from '../userOperation/userOperation'
import { AbstractPaymaster } from './abstractPaymaster'

/**
 * Available paymaster types:
 * - Ambire: when using the standart Ambire paymaster, fee is expected
 * in native, allowed tokens or the gas tank
 * - ERC7677: when a dapp requests sponsorship via ERC-7677:
 * https://eips.ethereum.org/EIPS/eip-7677
 * - SwapSponsorship: used for inner swap & bridge. When the txn fee is lower
 * than the swap fee, the paymaster sponsors the userOperation
 */
type PaymasterType = 'Ambire' | 'ERC7677' | 'SwapSponsorship' | 'None'

export function getPaymasterDataForEstimate(): PaymasterEstimationData {
  const abiCoder = new AbiCoder()
  return {
    paymaster: AMBIRE_PAYMASTER,
    paymasterVerificationGasLimit: toBeHex(42000) as Hex,
    paymasterPostOpGasLimit: toBeHex(0) as Hex,
    paymasterData: abiCoder.encode(
      ['uint48', 'uint48', 'bytes'],
      [0, 0, getSigForCalculations()]
    ) as Hex
  }
}

function getSwapSponsorshipEstimationData(): PaymasterEstimationData {
  const paymasterData = getPaymasterDataForEstimate()
  return {
    ...paymasterData,
    sponsor: {
      name: 'Ambire Wallet',
      icon: 'https://cena.ambire.com/public/ambire-logos/symbol-color.svg'
    }
  }
}

export class Paymaster extends AbstractPaymaster {
  callRelayer: Function

  type: PaymasterType = 'None'

  op: AccountOp | null = null

  #account: Account | null = null

  paymasterService: PaymasterService | null = null

  network: Network | null = null

  provider: RPCProvider | null = null

  errorCallback: Function | undefined = undefined

  // this is a temporary solution where the live relayer doesn't have
  // a chain id paymaster route open yet as it's not merged
  ambirePaymasterUrl: string | undefined

  #relayerUrl: string

  constructor(relayerUrl: string, fetch: Fetch, errorCallback: Function) {
    super()
    this.callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    this.errorCallback = errorCallback
    this.#relayerUrl = relayerUrl
  }

  async #tryToSetErc7677(userOp: UserOperation) {
    if (!this.paymasterService || !this.#account || !this.network) return

    try {
      // when requesting stub data with an empty account, send over
      // the deploy data as per EIP-7677 standard
      const localOp = { ...userOp }
      if (BigInt(localOp.nonce) === 0n && this.#account.creation) {
        const factoryInterface = new Interface(AmbireFactory.abi)
        localOp.factory = this.#account.creation.factoryAddr
        localOp.factoryData = factoryInterface.encodeFunctionData('deploy', [
          this.#account.creation.bytecode,
          this.#account.creation.salt
        ])
      }

      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const response = await Promise.race([
          getPaymasterStubData(this.paymasterService, localOp, this.network),
          new Promise((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Sponsorship error, request too slow')),
              5000
            )
          })
        ])
        this.sponsorDataEstimation = response as PaymasterEstimationData
        this.type = 'ERC7677'
        return
      } finally {
        if (timeout !== undefined) clearTimeout(timeout)
      }
    } catch (e) {
      console.log('ERC7677 sponsorship declined', e)
    }
  }

  async init(
    op: AccountOp,
    userOp: UserOperation,
    account: Account,
    network: Network,
    provider: RPCProvider
  ) {
    this.op = op
    this.network = network
    this.provider = provider
    this.#account = account
    this.ambirePaymasterUrl = `/v2/paymaster/${this.network.chainId}/request`
    if (op.meta?.paymasterService) this.paymasterService = op.meta.paymasterService

    // try to init ERC-7677 if a paymasterService has been provided and it hasn't failed
    if (op.meta?.paymasterService && !op.meta?.paymasterService.failed) {
      await this.#tryToSetErc7677(userOp)
      if (this.type === 'ERC7677') return
    }

    // has the paymaster dried up
    const seenInsufficientFunds =
      failedPaymasters.insufficientFundsNetworks[Number(this.network.chainId)]

    if (network.erc4337.hasPaymaster && !seenInsufficientFunds) {
      this.type = 'Ambire'
      return
    }

    // for custom networks, check if the paymaster there has balance
    if (!network.predefined || seenInsufficientFunds) {
      try {
        const ep = new Contract(ERC_4337_ENTRYPOINT, entryPointAbi, provider) as any
        const paymasterBalance = await ep.balanceOf(AMBIRE_PAYMASTER)

        // if the network paymaster has failed because of insufficient funds,
        // disable it before getting a top up
        const minBalance = seenInsufficientFunds ? seenInsufficientFunds.lastSeenBalance : 0n
        if (paymasterBalance > minBalance) {
          this.type = 'Ambire'
          if (seenInsufficientFunds) failedPaymasters.removeInsufficientFunds(network)
          return
        }
      } catch (e) {
        console.log('failed to retrieve the balance of the paymaster')
        console.error(e)
      }
    }

    this.type = 'None'
  }

  shouldIncludePayment(): boolean {
    return (
      this.type === 'Ambire' ||
      (this.type === 'ERC7677' && this.sponsorDataEstimation?.paymaster === AMBIRE_PAYMASTER) ||
      this.type === 'SwapSponsorship'
    )
  }

  // get the fee call type used in the estimation
  // we use this to understand whether we should re-estimate on broadcast
  getFeeCallType(feeTokens: TokenResult[]): string | undefined {
    if (!this.network) throw new Error('network not set, did you call init?')

    if (this.type === 'Ambire') {
      const feeToken = getFeeTokenForEstimate(feeTokens)
      if (!feeToken) return undefined
      if (feeToken.flags.onGasTank) return 'gasTank'
      if (feeToken.address === ZeroAddress) return 'native'
      return 'erc20'
    }

    if (this.isSponsored()) return 'gasTank'
    return undefined
  }

  getFeeCallForEstimation(feeTokens: TokenResult[]): Call | undefined {
    if (!this.network) throw new Error('network not set, did you call init?')

    if (this.type === 'Ambire') {
      const feeToken = getFeeTokenForEstimate(feeTokens)
      if (!feeToken) return undefined

      return getFeeCall(feeToken)
    }

    // hardcode USDC gas tank 0 for sponsorships
    if (this.isSponsored()) {
      const abiCoder = new AbiCoder()
      return {
        to: FEE_COLLECTOR,
        value: 0n,
        data: abiCoder.encode(['string', 'uint256', 'string'], ['gasTank', 0n, 'USDC'])
      }
    }

    return undefined
  }

  getEstimationData(): PaymasterEstimationData | null {
    if (this.type === 'ERC7677') return this.sponsorDataEstimation as PaymasterEstimationData

    if (this.type === 'Ambire') return getPaymasterDataForEstimate()

    if (this.type === 'SwapSponsorship') return getSwapSponsorshipEstimationData()

    return null
  }

  isSponsored(): boolean {
    return this.type === 'ERC7677' || this.type === 'SwapSponsorship'
  }

  isUsable() {
    return this.type !== 'None'
  }

  async #retryPaymasterRequest(
    apiCall: Function,
    counter = 0
  ): Promise<PaymasterSuccessReponse | PaymasterErrorReponse> {
    // retry the request 3 times before declaring it a failure
    if (counter >= 3) {
      const e = new Error('Ambire relayer error timeout')
      const convertedError = new RelayerPaymasterError(e)
      const { message } = getHumanReadableBroadcastError(convertedError)
      return {
        success: false,
        message,
        error: e
      }
    }

    try {
      const response = await Promise.race([
        apiCall(),
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('Ambire relayer error timeout')), 8000)
        })
      ])

      const isAmbirePaymaster = this.type === 'Ambire' || this.type === 'SwapSponsorship'
      return {
        success: true,
        paymaster: isAmbirePaymaster ? AMBIRE_PAYMASTER : response.paymaster,
        paymasterData: isAmbirePaymaster ? response.data.paymasterData : response.paymasterData,
        signature: isAmbirePaymaster ? response.data.signature : undefined
      }
    } catch (e: any) {
      if (e.message === 'Ambire relayer error timeout') {
        if (this.errorCallback) {
          this.errorCallback({
            level: 'major',
            message: 'Paymaster is not responding. Retrying...',
            error: new Error('Paymaster call timeout')
          })
        }
        const increment = counter + 1
        return this.#retryPaymasterRequest(apiCall, increment)
      }

      const convertedError =
        this.type === 'ERC7677' ? new SponsorshipPaymasterError() : new RelayerPaymasterError(e)
      const message = convertedError.isHumanized
        ? convertedError.message
        : getHumanReadableBroadcastError(convertedError).message
      return {
        success: false,
        message,
        error: e
      }
    }
  }

  async #ambireCall(
    acc: Account,
    op: AccountOp,
    userOp: UserOperation
  ): Promise<PaymasterSuccessReponse | PaymasterErrorReponse> {
    if (!this.provider) throw new Error('provider not set, did you call init?')
    if (!this.network) throw new Error('network not set, did you call init?')

    // request the paymaster with a timeout window
    const localUserOp = { ...userOp }
    localUserOp.paymaster = AMBIRE_PAYMASTER
    return this.#retryPaymasterRequest(() => {
      return this.callRelayer(this.ambirePaymasterUrl, 'POST', {
        userOperation: getCleanUserOp(localUserOp)[0],
        paymaster: AMBIRE_PAYMASTER,
        bytecode: acc.creation?.bytecode,
        salt: acc.creation?.salt,
        key: acc.associatedKeys[0],

        rpcUrl: this.provider!._getConnection().url,
        bundler: userOp.bundler,
        swapSponsorship:
          this.type === 'SwapSponsorship' && this.op?.meta?.swapSponsorship
            ? {
                price: this.op.meta.swapSponsorship.feeTokenPriceInUsd,
                decimals: this.op.meta.swapSponsorship.feeTokenDecimals
              }
            : undefined
      })
    })
  }

  async #erc7677Call(op: AccountOp, userOp: UserOperation, network: Network) {
    const sponsorData = this.sponsorDataEstimation as PaymasterEstimationData

    // no need to do an extra call if the dapp has already provided sponsorship
    if ('isFinal' in sponsorData && sponsorData.isFinal)
      return {
        success: true,
        paymaster: sponsorData.paymaster,
        paymasterData: sponsorData.paymasterData
      }

    const localUserOp = { ...userOp }
    localUserOp.paymaster = sponsorData.paymaster
    localUserOp.paymasterData = sponsorData.paymasterData
    const response = await this.#retryPaymasterRequest(() => {
      return getPaymasterData(this.paymasterService as PaymasterService, localUserOp, network)
    })

    if (!response.success && op.meta && op.meta.paymasterService) {
      failedPaymasters.addFailedSponsorship(op.meta.paymasterService.id)
    }

    return response
  }

  async call(
    acc: Account,
    op: AccountOp,
    userOp: UserOperation,
    network: Network
  ): Promise<PaymasterSuccessReponse | PaymasterErrorReponse> {
    if (this.isAmbire()) return this.#ambireCall(acc, op, userOp)

    if (this.type === 'ERC7677') return this.#erc7677Call(op, userOp, network)

    throw new Error('Paymaster not configured. Please contact support')
  }

  isAmbire(): boolean {
    return this.type === 'Ambire' || this.type === 'SwapSponsorship'
  }

  isEstimateBelowMin(localOp: UserOperation): boolean {
    const min = this.getEstimationData()
    if (!min || !min.paymasterVerificationGasLimit) return false

    return (
      localOp.paymasterVerificationGasLimit === undefined ||
      BigInt(localOp.paymasterVerificationGasLimit) < BigInt(min.paymasterVerificationGasLimit)
    )
  }

  async #tryToSetSwapSponsorship(
    bundlerEstimateResult: BundlerEstimateResult,
    gasPrices: GasSpeeds,
    userOp: UserOperation
  ) {
    if (!this.op?.meta?.swapSponsorship || !this.network) return

    const gas =
      BigInt(bundlerEstimateResult.callGasLimit) + BigInt(bundlerEstimateResult.preVerificationGas)
    const amountInWei = gas * BigInt(gasPrices.ape.maxFeePerGas)
    const cost = Number(
      safeTokenAmountAndNumberMultiplication(
        amountInWei,
        18,
        this.op.meta.swapSponsorship.nativePrice
      )
    )
    const costPlusOverhead = cost + cost * 0.25
    if (costPlusOverhead >= this.op.meta.swapSponsorship.swapFeeInUsd) {
      console.log('no sponsorship as cost is not justified')
      return
    }

    // call the paymaster for a final validation before showing the
    // "Swap Sponsorship screen" as providers often change their implementation
    // and we need confirmation from the relayer that the sponsorship is
    // eligible before declaring it. Otherwise, we run the risk of the paymaster
    // declining the sponsorship when the user clicks "Sign"
    let sponsorshipTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        getPaymasterStubData(
          {
            url: getAmbireSponsorshipUrl(this.#relayerUrl),
            id: generateUuid(),
            context: {
              policyId: AMBIRE_SWAP_POLICY,
              swapSponsorship: {
                price: this.op.meta.swapSponsorship.feeTokenPriceInUsd,
                decimals: this.op.meta.swapSponsorship.feeTokenDecimals
              }
            }
          },
          userOp,
          this.network
        ),
        new Promise((_resolve, reject) => {
          sponsorshipTimeout = setTimeout(
            () => reject(new Error('Sponsorship error, request too slow')),
            4000
          )
        })
      ])
      this.type = 'SwapSponsorship'
    } catch (e) {
      console.log('Sponsorship declined', e)
    } finally {
      if (sponsorshipTimeout !== undefined) clearTimeout(sponsorshipTimeout)
    }
  }

  /**
   * We use the upgrade method when we initially need to start with another
   * paymaster type, e.g. Ambire, but then we understand we can use another
   * one because special conditions apply.
   * One such case is the swap&bridge where we first need to know the estimation
   * from the bundler so we could calculate the txn fee. If the swap fee is
   * bigger than the txn fee, we upgrade the paymaster to SwapSponsorship.
   */
  async upgrade(
    bundlerEstimateResult: BundlerEstimateResult,
    gasPrices: GasSpeeds,
    userOp: UserOperation
  ): Promise<void> {
    // ERC7677 is already sponsoring the userOperation so we don't upgrade over it
    if (this.type === 'ERC7677' || !this.network) return

    // do not upgrade over the gnosis paymaster sponsorship
    if (
      this.type === 'Ambire' &&
      this.paymasterService?.context?.policyId === AMBIRE_NETWORK_WIDE_SPONSORSHIP_POLICY
    )
      return

    // apply estimation and gas changes to the userOp so a more realistic,
    // final userOp could be sent over for paymaster stub data
    //
    // do not use structuredClone here as we rely on mutating nested objects
    const localOp = { ...userOp }
    localOp.preVerificationGas = bundlerEstimateResult.preVerificationGas
    localOp.verificationGasLimit = bundlerEstimateResult.verificationGasLimit
    localOp.callGasLimit = bundlerEstimateResult.callGasLimit
    localOp.maxFeePerGas = gasPrices.medium.maxFeePerGas
    localOp.maxPriorityFeePerGas = gasPrices.medium.maxPriorityFeePerGas

    await this.#tryToSetSwapSponsorship(bundlerEstimateResult, gasPrices, localOp)
    if (!!this.op?.meta?.swapSponsorship) return

    // try to init ERC-7677 if a paymasterService has been provided and it hasn't failed
    if (this.op?.meta?.paymasterService && !this.op.meta.paymasterService.failed)
      await this.#tryToSetErc7677(localOp)
  }
}
