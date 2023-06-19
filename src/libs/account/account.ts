import { Interface, ethers } from 'ethers'
import { PrivLevels } from 'libs/proxyDeploy/deploy'
import { Account } from '../../interfaces/account'
// returns to, data
export function getAccountDeployParams(account: Account): [string, string] {
  const factory = new Interface(['function deploy(bytes calldata code, uint256 salt) external'])
  return [
    account.factoryAddr,
    factory.encodeFunctionData('deploy', [account.bytecode, account.salt])
  ]
}

export class AccountController {
  private fetch: Function

  private relayerUrl: string

  constructor(fetch: Function, relayerUrl: string) {
    this.fetch = fetch
    this.relayerUrl = relayerUrl
  }

  async createAccount(acc: any, expectedAddr: string, privileges: PrivLevels[]): Promise<any> {
    const newPrivs = privileges.map((el) => [el.addr, el.hash])
    const args = {
      salt: acc.salt,
      bytecode: acc.bytecode,
      identityFactoryAddr: acc.identityFactoryAddr,
      utm: null,
      referralAddr: expectedAddr,
      registeredFrom: null,
      baseIdentityAddr: acc.baseIdentityAddr,
      privileges: newPrivs
    }
    const resp = await this.fetch(`${this.relayerUrl}/v2/identity/${expectedAddr}`, {
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST',
      body: JSON.stringify(args)
    })
    const result: any = await resp.json()
    if (!result.success) throw new Error(`accountController: create account: ${result.message}`)
    return result.data
  }
}
