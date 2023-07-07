import { fromDescriptor, parseErr } from '../deployless/deployless'
import { getAccountDeployParams } from '../account/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { AccountOp, callToTuple } from '../accountOp/accountOp'
import { Account } from '../../interfaces/account'
import { Provider } from 'ethers'
import estimator from './estimator.json'

// @TODO return type
export async function estimate(
  provider: Provider,
  network: NetworkDescriptor,
  account: Account,
  op: AccountOp,
  blockTag: string | number = 'latest'
): Promise<any> {
  //@ TODO implement EOAs
  if (!account.creation) throw new Error('EOA not supported yet')
  const deploylessEstimator = fromDescriptor(provider, estimator, !network.rpcNoStateOverride)

  // @TODO this is temp
  const nativeToCheck = ['0x0000000000000000000000000000000000000001', '0x942f9CE5D9a33a82F88D233AEb3292E680230348']
  const feeTokens: string[]= [
    '0x0000000000000000000000000000000000000000',
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  ]
  const args = [
    account.addr,
    ...getAccountDeployParams(account),
    // @TODO can pass 0 here for the addr
    // @TODO op.accountOpToExecuteBefore
    [account.addr, 0n, [], '0x'],
    [account.addr, op.nonce || 0, op.calls, '0x'],
    account.associatedKeys,

    feeTokens,
    // @TODO
    '0x942f9CE5D9a33a82F88D233AEb3292E680230348',
    nativeToCheck
  ]
  const [ estimationResult ] = await deploylessEstimator.call('estimate', args, { from: '0x0000000000000000000000000000000000000001', blockTag })
  return estimationResult
}
