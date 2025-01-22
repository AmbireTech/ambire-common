/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { Network } from '../../interfaces/network'
import { UserOperation } from '../../libs/userOperation/types'
import { Pimlico } from './pimlico'

/**
 * DANGER
 * This class is made purely for the intention of using it for tests
 * where the broadcast fails but everything else should work.
 * When broadcast fails, estimation should switch to biconomy
 * and continue on
 */
export class BrokenPimlicoBroadcast extends Pimlico {
  broadcast(userOperation: UserOperation, network: Network): Promise<string> {
    throw new Error('Internal error from bundler')
  }
}
