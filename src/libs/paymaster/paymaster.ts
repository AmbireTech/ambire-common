import { AbiCoder, toBeHex } from 'ethers'

import { AMBIRE_PAYMASTER } from '../../consts/deploy'
import { Account } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { failedSponsorships } from '../../services/paymaster/FailedSponsorships'
import { AccountOp } from '../accountOp/accountOp'
import { getPaymasterData, getPaymasterStubData } from '../erc7677/erc7677'
import {
  PaymasterErrorReponse,
  PaymasterEstimationData,
  PaymasterService,
  PaymasterSuccessReponse
} from '../erc7677/types'
import { RelayerPaymasterError, SponsorshipPaymasterError } from '../errorDecoder/customErrors'
import { getHumanReadableBroadcastError } from '../errorHumanizer'
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

  constructor(callRelayer: Function) {
    this.callRelayer = callRelayer
  }

  async init(op: AccountOp, userOp: UserOperation, network: Network) {
    if (op.meta?.paymasterService && !op.meta?.paymasterService.failed) {
      try {
        this.paymasterService = op.meta.paymasterService
        this.sponsorDataEstimation = await getPaymasterStubData(
          op.meta.paymasterService,
          userOp,
          network
        )
        this.type = 'ERC7677'
        return
      } catch (e) {
        // TODO: error handling
        console.log(e)
      }
    }

    if (network.erc4337.hasPaymaster) {
      this.type = 'Ambire'
      return
    }

    this.type = 'None'
  }

  shouldIncludePayment(): boolean {
    return this.type === 'Ambire'
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
          key: acc.associatedKeys[0]
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
      if (op.meta && op.meta.paymasterService) failedSponsorships.add(op.meta.paymasterService.id)
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
