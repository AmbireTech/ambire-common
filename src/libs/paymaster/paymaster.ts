import { AbiCoder, toBeHex } from 'ethers'

import { AMBIRE_PAYMASTER } from '../../consts/deploy'
import { Account } from '../../interfaces/account'
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
  callRelayer: Function

  type: PaymasterType = 'None'

  sponsorDataEstimation: PaymasterEstimationData | undefined

  constructor(callRelayer: Function) {
    this.callRelayer = callRelayer
  }

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

  isSponsored(): boolean {
    return this.type === 'ERC7677'
  }

  isUsable() {
    return this.type !== 'None'
  }

  async call(acc: Account, op: AccountOp, userOp: UserOperation) {
    // request the paymaster with a timeout window
    const response = await Promise.race([
      this.callRelayer(`/v2/paymaster/${op.networkId}/sign`, 'POST', {
        // send without the requestType prop
        userOperation: (({ requestType, activatorCall, ...o }) => o)(userOp),
        paymaster: AMBIRE_PAYMASTER,
        bytecode: acc.creation!.bytecode,
        salt: acc.creation!.salt,
        key: acc.associatedKeys[0]
      }),
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('Ambire relayer error')), 8000)
      })
    ])
  }
}
