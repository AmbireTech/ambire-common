/* eslint-disable class-methods-use-this */
import { toBeHex } from 'ethers'

import { BUNDLER, PIMLICO } from '../../consts/bundlers'
import { ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { EOA_SIMULATION_NONCE } from '../../consts/deployless'
import { Network } from '../../interfaces/network'
import { BundlerEstimateResult } from '../../libs/estimate/interfaces'
import { UserOperation } from '../../libs/userOperation/types'
import { getCleanUserOp } from '../../libs/userOperation/userOperation'
import { Bundler } from './bundler'
import { GasSpeeds, UserOpStatus } from './types'

export class Pimlico extends Bundler {
  protected getUrl(network: Network): string {
    return `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`
  }

  protected async getGasPrice(network: Network): Promise<GasSpeeds> {
    const provider = this.getProvider(network)
    const prices: any = await provider.send('pimlico_getUserOperationGasPrice', [])
    prices.medium = prices.standard
    prices.ape = prices.fast
    delete prices.standard
    return prices
  }

  public async getStatus(network: Network, userOpHash: string): Promise<UserOpStatus> {
    const provider = this.getProvider(network)
    return provider.send('pimlico_getUserOperationStatus', [userOpHash])
  }

  public getName(): BUNDLER {
    return PIMLICO
  }

  private async send7702EstimateReq(
    userOperation: UserOperation,
    network: Network,
    shouldStateOverride = false
  ): Promise<BundlerEstimateResult> {
    const provider = this.getProvider(network)

    if (shouldStateOverride) {
      return provider.send('pimlico_experimental_estimateUserOperationGas7702', [
        {
          ...getCleanUserOp(userOperation)[0]
        },
        ERC_4337_ENTRYPOINT,
        {
          [userOperation.sender]: {
            stateDiff: {
              [toBeHex(1, 32)]: EOA_SIMULATION_NONCE
            }
          }
        }
      ])
    }

    return provider.send('pimlico_experimental_estimateUserOperationGas7702', [
      {
        ...getCleanUserOp(userOperation)[0]
      },
      ERC_4337_ENTRYPOINT
    ])
  }
}
