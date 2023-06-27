import { Interface, ethers } from 'ethers'
import { PrivLevels } from 'libs/proxyDeploy/deploy'
import { AccountOp } from 'libs/accountOp/accountOp'
import { NetworkDescriptor } from 'interfaces/networkDescriptor'
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
  private fetch: Function

  private relayerUrl: string

  private provider: any

  constructor(fetch: Function, relayerUrl: string, provider: any) {
    this.fetch = fetch
    this.relayerUrl = relayerUrl
    this.provider = provider
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
    const resp = await this.fetch(`${this.relayerUrl}/v2/identity/${expectedAddr}`, {
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST',
      body: JSON.stringify(args)
    })
    const result: any = await resp.json()
    if (!result.success) return `accountController: create account: ${result.message}`
    return result
  }

  async getAccount(identity: string): Promise<any> {
    const resp = await this.fetch(`${this.relayerUrl}/v2/identity/${identity}`)
    const result: any = await resp.json()

    if (result.errType) throw new Error(`accountController: get account: ${result.errType}`)
    return result
  }

  async getAccountsByEmail(email: string, authKey: string): Promise<any> {
    const resp = await this.fetch(`${this.relayerUrl}/v2/identity/by-email/${email}/${authKey}`)
    const result: any = await resp.json()

    if (result.errType)
      throw new Error(`accountController: get account by email: ${result.errType}`)
    return result
  }

  async getPrivileges(identity: string, network: string): Promise<any> {
    const resp = await this.fetch(
      `${this.relayerUrl}/v2/identity/${identity}/${network}/privileges`
    )
    const result: any = await resp.json()

    if (result.errType) throw new Error(`accountController: get priviliges: ${result.errType}`)
    return result
  }

  async getAccountsBySigner(signature: string): Promise<any> {
    const resp = await this.fetch(`${this.relayerUrl}/v2/account-by-signer/${signature}`)
    const result: any = await resp.json()
    if (result.errType)
      throw new Error(`accountController: get identities from signer: ${result.errType}`)
    return result
  }

  async submit(identity: string, network: string, args: any): Promise<any> {
    const resp = await this.fetch(`${this.relayerUrl}/v2/identity/${identity}/${network}/submit`, {
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST',
      body: JSON.stringify(args)
    })
    const result: any = await resp.json()
    if (result.errType) throw new Error(`accountController: submit: ${result.errType}`)
    return result
  }

  async cancel(identity: string, network: string, args: any): Promise<any> {
    const resp = await this.fetch(`${this.relayerUrl}/v2/identity/${identity}/${network}/cancel`, {
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST',
      body: JSON.stringify(args)
    })
    const result: any = await resp.json()
    if (result.errType) throw new Error(`accountController: cancel: ${result.errType}`)
    return result
  }
}

// estimate from estimator
// privs
// add signer
// remove signer
// recoveyr tx
