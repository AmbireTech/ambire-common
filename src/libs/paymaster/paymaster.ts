import { AbiCoder, toBeHex } from 'ethers'

import { AMBIRE_PAYMASTER } from '../../consts/deploy'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { getPaymasterStubData } from '../erc7677/erc7677'
import { PaymasterEstimationData } from '../erc7677/types'
import { UserOperation } from '../userOperation/types'
import { getSigForCalculations } from '../userOperation/userOperation'

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
  type: PaymasterType = 'None'

  sponsorDataEstimation: PaymasterEstimationData | undefined

  async init(op: AccountOp, userOp: UserOperation, network: Network) {
    if (op.meta?.paymasterService) {
      try {
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
}
