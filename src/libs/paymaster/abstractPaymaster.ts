import { Account } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import {
  PaymasterErrorReponse,
  PaymasterEstimationData,
  PaymasterSuccessReponse
} from '../erc7677/types'
import { TokenResult } from '../portfolio'
import { UserOperation } from '../userOperation/types'

/**
 * Use this mainly as a typehint to prevent dependancy cicles
 */
export abstract class AbstractPaymaster {
  abstract init(op: AccountOp, userOp: UserOperation, network: Network, provider: RPCProvider): void

  abstract shouldIncludePayment(): boolean

  abstract getFeeCallType(feeTokens: TokenResult[]): string | undefined

  abstract getFeeCallForEstimation(feeTokens: TokenResult[]): Call | undefined

  abstract getEstimationData(): PaymasterEstimationData | null

  abstract isSponsored(): boolean

  abstract isUsable(): boolean

  abstract call(
    acc: Account,
    op: AccountOp,
    userOp: UserOperation,
    network: Network
  ): Promise<PaymasterSuccessReponse | PaymasterErrorReponse>
}
