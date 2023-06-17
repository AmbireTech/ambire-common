import { fromDescriptor, parseErr } from '../deployless/deployless'
import { getAccountDeployParams } from '../account/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { AccountOp, callToTuple } from '../accountOp/accountOp'
import { Account } from '../../interfaces/account'
import { Provider } from 'ethers'
import estimator from './estimator.json'

// @TODO return type
export async function estimate(provider: Provider, network: NetworkDescriptor, op: AccountOp): Promise<any> {
  // @TODO construrct Deployless instance
  const deploylessEstimator = fromDescriptor(provider, estimator, !network.rpcNoStateOverride)
}

// @TODO test
// transfer some random token from 0xa07D75aacEFd11b425AF7181958F0F85c312f143
// USDT, USDC
