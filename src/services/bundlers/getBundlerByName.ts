import { BICONOMY, BUNDLER, ETHERSPOT, PIMLICO } from '../../consts/bundlers'
import { Biconomy } from './biconomy'
import { Bundler } from './bundler'
import { Etherspot } from './etherspot'
import { Pimlico } from './pimlico'

export function getBundlerByName(bundlerName: BUNDLER): Bundler {
  switch (bundlerName) {
    case PIMLICO:
      return new Pimlico()

    case BICONOMY:
      return new Biconomy()

    case ETHERSPOT:
      return new Etherspot()

    default:
      throw new Error('Bundler settings error')
  }
}
