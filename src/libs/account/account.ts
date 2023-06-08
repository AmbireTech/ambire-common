import { Interface } from 'ethers'
import { Account } from '../../interfaces/account'

// returns to, data
export function getAccountDeployParams(account: Account): [string, string] {
  const factory = new Interface(['function deploy(bytes calldata code, uint256 salt) external'])
  return [
    account.factoryAddr,
    factory.encodeFunctionData('deploy', [account.bytecode, account.salt])
  ]
}
