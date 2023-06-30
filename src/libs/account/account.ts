import { Interface, ethers } from 'ethers'
import { PrivLevels } from 'libs/proxyDeploy/deploy'
import { AccountOp } from 'libs/accountOp/accountOp'
import { NetworkDescriptor } from 'interfaces/networkDescriptor'
import { relayerCall } from '../relayerCall/relayerCall'
import { estimate } from '../estimate/estimate'
import { Account } from '../../interfaces/account'
// returns to, data
export function getAccountDeployParams(account: Account): [string, string] {
  if (account.creation === null) throw new Error('tried to get deployment params for an EOA')
  const factory = new Interface(['function deploy(bytes calldata code, uint256 salt) external'])
  return [
    account.creation.factoryAddr,
    factory.encodeFunctionData('deploy', [account.creation.bytecode, account.creation.salt])
  ]
}

export class AccountController {
  private provider: any

  private callRelayer: Function

  constructor(relayerUrl: string, provider: any) {
    this.provider = provider
    this.callRelayer = relayerCall.bind({ url: relayerUrl })
  }

  async createAccount(
    acc: any,
    expectedAddr: string,
    emailArgs: { email: string; authKey: string }
  ): Promise<any> {
    const newPrivs = acc.privileges.map((el: any) => [el.addr, el.hash])
    const args = {
      salt: acc.salt,
      bytecode: acc.bytecode,
      identityFactoryAddr: acc.identityFactoryAddr,
      utm: null,
      referralAddr: expectedAddr,
      registeredFrom: null,
      baseIdentityAddr: acc.baseIdentityAddr,
      privileges: newPrivs,
      email: emailArgs.email,
      magicLinkKey: emailArgs.authKey
    }
    return this.callRelayer(`/v2/identity/${expectedAddr}`, 'POST', args)
  }

  async getAccount(identity: string): Promise<any> {
    return this.callRelayer(`/v2/identity/${identity}`)
  }

  async getAccountsByEmail(email: string, authKey: string): Promise<any> {
    return this.callRelayer(`/v2/identity/by-email/${email}/${authKey}`)
  }

  async getPrivileges(identity: string, network: string): Promise<any> {
    return this.callRelayer(`/v2/identity/${identity}/${network}/privileges`)
  }

  async getAccountsByKey(signature: string): Promise<any> {
    return this.callRelayer(`/v2/account-by-signer/${signature}`)
  }

  async submit(identity: string, network: string, args: any): Promise<any> {
    return this.callRelayer(`/v2/identity/${identity}/${network}/submit`, 'POST', args)
  }

  async cancel(identity: string, network: string, args: any): Promise<any> {
    return this.callRelayer(`/v2/identity/${identity}/${network}/cancel`, 'POST', args)
  }
}

// estimate from estimator
// privs
// add signer
// remove signer
// recoveyr tx
