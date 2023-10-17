import { ethers, Interface } from 'ethers'

import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { Account } from '../../interfaces/account'
import { getBytecode } from '../proxyDeploy/bytecode'
import { getAmbireAccountAddress } from '../proxyDeploy/getAmbireAddressTwo'
import { PrivLevels } from '../../libs/proxyDeploy/deploy'

// returns to, data
export function getAccountDeployParams(account: Account): [string, string] {
  if (account.creation === null) throw new Error('tried to get deployment params for an EOA')
  const factory = new Interface(['function deploy(bytes calldata code, uint256 salt) external'])
  return [
    account.creation.factoryAddr,
    factory.encodeFunctionData('deploy', [account.creation.bytecode, account.creation.salt])
  ]
}

export function getLegacyAccount(key: string): Account {
  return {
    addr: key,
    label: '',
    pfp: '',
    associatedKeys: [key],
    creation: null
  }
}

export async function getSmartAccount(privileges: PrivLevels[]): Promise<Account> {
  const bytecode = await getBytecode(privileges)
  return {
    addr: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode),
    label: '',
    pfp: '',
    associatedKeys: privileges.map(priv => priv.addr),
    creation: {
      factoryAddr: AMBIRE_ACCOUNT_FACTORY,
      bytecode,
      salt: ethers.toBeHex(0, 32)
    }
  }
}

export const isAmbireV1LinkedAccount = (factoryAddr?: string) =>
  factoryAddr === '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA'
