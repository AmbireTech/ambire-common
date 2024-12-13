/* eslint-disable no-console */
import { AbiCoder, Contract, toBeHex } from 'ethers'

import entryPointAbi from '../../../contracts/compiled/EntryPoint.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { AMBIRE_PAYMASTER, ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Account } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { failedPaymasters } from '../../services/paymaster/FailedPaymasters'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import { getFeeCall } from '../calls/calls'
import { getPaymasterData, getPaymasterStubData } from '../erc7677/erc7677'
import {
  PaymasterErrorReponse,
  PaymasterEstimationData,
  PaymasterService,
  PaymasterSuccessReponse
} from '../erc7677/types'
import { RelayerPaymasterError, SponsorshipPaymasterError } from '../errorDecoder/customErrors'
import { getHumanReadableBroadcastError } from '../errorHumanizer'
import { getFeeTokenForEstimate } from '../estimate/estimateHelpers'
import { TokenResult } from '../portfolio'
import { UserOperation } from '../userOperation/types'
import { getCleanUserOp, getSigForCalculations } from '../userOperation/userOperation'

type PaymasterType = 'Ambire' | 'ERC7677' | 'None'

export function getPaymasterDataForEstimate(): PaymasterEstimationData {
  const abiCoder = new AbiCoder()
  return {
    paymaster: AMBIRE_PAYMASTER,
    paymasterVerificationGasLimit: toBeHex(0) as `0x${string}`,
    paymasterPostOpGasLimit: toBeHex(0) as `0x${string}`,
    paymasterData: abiCoder.encode(
      ['uint48', 'uint48', 'bytes'],
      [0, 0, getSigForCalculations()]
    ) as `0x${string}`
  }
}

export class Paymaster {
  callRelayer: Function

  type: PaymasterType = 'None'

  sponsorDataEstimation: PaymasterEstimationData | undefined

  paymasterService: PaymasterService | null = null

  network: Network | null = null

  provider: RPCProvider | null = null

  constructor(callRelayer: Function) {
    this.callRelayer = callRelayer
  }

  async init(op: AccountOp, userOp: UserOperation, network: Network, provider: RPCProvider) {
    this.network = network
    this.provider = provider

    if (op.meta?.paymasterService && !op.meta?.paymasterService.failed) {
      try {
        this.paymasterService = op.meta.paymasterService
        const response = await Promise.race([
          getPaymasterStubData(op.meta.paymasterService, userOp, network),
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error('Sponsorship error, request too slow')), 5000)
          })
        ])
        this.sponsorDataEstimation = response as PaymasterEstimationData
        this.type = 'ERC7677'
        return
      } catch (e) {
        // TODO: error handling
        console.log(e)
      }
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
        const ep = new Contract(ERC_4337_ENTRYPOINT, entryPointAbi, provider)
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
    return this.type === 'Ambire' || this.type === 'ERC7677'
  }

  getFeeCallForEstimation(feeTokens: TokenResult[]): Call | undefined {
    if (!this.network) throw new Error('network not set, did you call init?')

    if (this.type === 'Ambire') {
      const feeToken = getFeeTokenForEstimate(feeTokens, this.network)
      if (!feeToken) return undefined

      return getFeeCall(feeToken)
    }

    // hardcode USDC gas tank 0 for sponsorships
    if (this.type === 'ERC7677') {
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

    return null
  }

  isSponsored(): boolean {
    return this.type === 'ERC7677'
  }

  isUsable() {
    return this.type !== 'None'
  }

  async #ambireCall(
    acc: Account,
    op: AccountOp,
    userOp: UserOperation
  ): Promise<PaymasterSuccessReponse | PaymasterErrorReponse> {
    if (!this.provider) throw new Error('provider not set, did you call init?')

    try {
      // request the paymaster with a timeout window
      const localUserOp = { ...userOp }
      localUserOp.paymaster = AMBIRE_PAYMASTER
      const response = await Promise.race([
        this.callRelayer(`/v2/paymaster/${op.networkId}/sign`, 'POST', {
          userOperation: getCleanUserOp(localUserOp)[0],
          paymaster: AMBIRE_PAYMASTER,
          bytecode: acc.creation!.bytecode,
          salt: acc.creation!.salt,
          key: acc.associatedKeys[0],
          // eslint-disable-next-line no-underscore-dangle
          rpcUrl: this.provider._getConnection().url
        }),
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('Ambire relayer error')), 8000)
        })
      ])

      return {
        success: true,
        paymaster: AMBIRE_PAYMASTER,
        paymasterData: response.data.paymasterData
      }
    } catch (e: any) {
      const convertedError = new RelayerPaymasterError(e)
      const { message } = getHumanReadableBroadcastError(convertedError)
      return {
        success: false,
        message,
        error: e
      }
    }
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

    try {
      const localUserOp = { ...userOp }
      localUserOp.paymaster = sponsorData.paymaster
      localUserOp.paymasterData = sponsorData.paymasterData
      const response: any = await Promise.race([
        getPaymasterData(this.paymasterService as PaymasterService, localUserOp, network),
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('Sponsorship error')), 8000)
        })
      ])
      return {
        success: true,
        paymaster: response.paymaster,
        paymasterData: response.paymasterData
      }
    } catch (e: any) {
      if (op.meta && op.meta.paymasterService) {
        failedPaymasters.addFailedSponsorship(op.meta.paymasterService.id)
      }

      const convertedError = new SponsorshipPaymasterError()
      const { message } = getHumanReadableBroadcastError(convertedError)
      return {
        success: false,
        message,
        error: e
      }
    }
  }

  async call(
    acc: Account,
    op: AccountOp,
    userOp: UserOperation,
    network: Network
  ): Promise<PaymasterSuccessReponse | PaymasterErrorReponse> {
    if (this.type === 'Ambire') return this.#ambireCall(acc, op, userOp)

    if (this.type === 'ERC7677') return this.#erc7677Call(op, userOp, network)

    throw new Error('Paymaster not configured. Please contact support')
  }
}
