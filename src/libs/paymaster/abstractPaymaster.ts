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
  /**
   * If there's a sponsorship from pm_getPaymasterStubData,
   * it will get recorded here. Use it for the final broadcast
   */
  sponsorDataEstimation: PaymasterEstimationData | undefined

  abstract init(
    op: AccountOp,
    userOp: UserOperation,
    account: Account,
    network: Network,
    provider: RPCProvider
  ): void

  abstract shouldIncludePayment(): boolean

  abstract getFeeCallType(feeTokens: TokenResult[]): string | undefined

  abstract getFeeCallForEstimation(feeTokens: TokenResult[]): Call | undefined

  abstract getEstimationData(): PaymasterEstimationData | null

  abstract isSponsored(): boolean

  abstract isUsable(): boolean

  abstract canAutoRetryOnFailure(): boolean

  abstract call(
    acc: Account,
    op: AccountOp,
    userOp: UserOperation,
    network: Network
  ): Promise<PaymasterSuccessReponse | PaymasterErrorReponse>

  abstract isEstimateBelowMin(userOperation: UserOperation): boolean
}
