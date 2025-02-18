/* eslint-disable class-methods-use-this */
import { toBeHex } from 'ethers'

import { BUNDLER, PIMLICO } from '../../consts/bundlers'
import { ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { EOA_SIMULATION_NONCE } from '../../consts/deployless'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { EIP7702Signature } from '../../interfaces/signatures'
import { Authorization, Message } from '../../interfaces/userRequest'
import { BundlerEstimateResult } from '../../libs/estimate/interfaces'
import { get7702SigV } from '../../libs/signMessage/signMessage'
import { UserOperation } from '../../libs/userOperation/types'
import { getCleanUserOp } from '../../libs/userOperation/userOperation'
import { Bundler } from './bundler'
import { GasSpeeds, UserOpStatus } from './types'

export class Pimlico extends Bundler {
  private getPimlicoAuthorization(authorizationMsg?: Message) {
    return authorizationMsg
      ? {
          contractAddress: (authorizationMsg.content as Authorization).contractAddr,
          chainId: toBeHex((authorizationMsg.content as Authorization).chainId),
          nonce: toBeHex((authorizationMsg.content as Authorization).nonce),
          r: (authorizationMsg.signature as EIP7702Signature).r,
          s: (authorizationMsg.signature as EIP7702Signature).s,
          v: get7702SigV(authorizationMsg.signature as EIP7702Signature),
          yParity: (authorizationMsg.signature as EIP7702Signature).yParity
        }
      : undefined
  }

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
    authorizationMsg?: Message,
    shouldStateOverride = false
  ): Promise<BundlerEstimateResult> {
    const provider = this.getProvider(network)

    if (shouldStateOverride) {
      return provider.send('pimlico_experimental_estimateUserOperationGas7702', [
        {
          ...getCleanUserOp(userOperation)[0],
          eip7702auth: this.getPimlicoAuthorization(authorizationMsg)
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
        ...getCleanUserOp(userOperation)[0],
        eip7702auth: this.getPimlicoAuthorization(authorizationMsg)
      },
      ERC_4337_ENTRYPOINT
    ])
  }

  async estimate7702(
    userOperation: UserOperation,
    network: Network,
    authorizationMsg?: Message
  ): Promise<BundlerEstimateResult> {
    const estimatiton = await this.send7702EstimateReq(
      userOperation,
      network,
      authorizationMsg,
      !!authorizationMsg
    )

    return {
      preVerificationGas: toBeHex(estimatiton.preVerificationGas) as Hex,
      verificationGasLimit: toBeHex(estimatiton.verificationGasLimit) as Hex,
      callGasLimit: toBeHex(estimatiton.callGasLimit) as Hex,
      paymasterVerificationGasLimit: toBeHex(estimatiton.paymasterVerificationGasLimit) as Hex,
      paymasterPostOpGasLimit: toBeHex(estimatiton.paymasterPostOpGasLimit) as Hex
    }
  }

  /**
   * Broadcast a userOperation for 7702 accounts to the specified bundler
   * and get a userOperationHash in return
   *
   * @param UserOperation userOperation
   * @returns userOperationHash
   */
  async broadcast7702(
    userOperation: UserOperation,
    network: Network,
    authorizationMsg?: Message
  ): Promise<string> {
    const provider = this.getProvider(network)
    return provider.send('pimlico_experimental_sendUserOperation7702', [
      {
        ...getCleanUserOp(userOperation)[0],
        eip7702auth: this.getPimlicoAuthorization(authorizationMsg)
      },
      ERC_4337_ENTRYPOINT
    ])
  }
}
