import { Provider } from 'ethers'
// import { networks } from '../../consts/networks'

import { fromDescriptor } from '../deployless/deployless'
import { getAccountDeployParams } from '../account/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Account, AccountOnchainState } from '../../interfaces/account'
import accountInfo from './accountInfo.json'

export async function getAccountInfo(
  provider: Provider,
  network: NetworkDescriptor,
  accounts: Account[],
  blockTag: string | number = 'latest'
): Promise<AccountOnchainState[]> {
  const deploylessAccountInfo = fromDescriptor(provider, accountInfo, !network.rpcNoStateOverride)

  const args = accounts.map((account) => [
    account.addr,
    account.associatedKeys,
    ...getAccountDeployParams(account)
  ])

  const [accountInfoResult] = await deploylessAccountInfo.call('getAccountsInfo', [args], {
    blockTag
  })

  const result: AccountOnchainState[] = accountInfoResult.map((acc: any, index: number) => {
    return {
      accountAddr: accounts[index].addr,
      nonce: parseInt(acc.nonce, 10),
      isDeployed: acc.isDeployed,
      associatedKeys: acc.associatedKeyPriviliges,
      deployError: !(acc.associatedKeyPriviliges.length > 0)
    }
  })

  return result
}

// const ethereum = networks.find((x) => x.id === 'ethereum')
// if (!ethereum) throw new Error('no eth')
// const provider = new JsonRpcProvider(ethereum.rpcUrl)

// const account = {
//   addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
//   label: '',
//   pfp: '',
//   associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
//   creation: {
//     factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
//     bytecode:
//       '0x7f28d4ea8f825adb036e9b306b2269570e63d2aa5bd10751437d98ed83551ba1cd7fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
//     salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
//   }
// }

// const notDeployedAccount = {
//   addr: '0x6C0937c7a04487573673a47F22E4Af9e96b91ecd',
//   label: '',
//   pfp: '',
//   associatedKeys: ['0xfF3f6D14DF43c112aB98834Ee1F82083E07c26BF'],
//   creation: {
//     factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
//     bytecode:
//       '0x7f1e7646e4695bead8bb0596679b0caf3a7ff6c4e04d2ad79103c8fa61fb6337f47fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
//     salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
//   }
// }

// getAccountInfo(provider, ethereum, [account, notDeployedAccount])
//   .then((res: any) => console.log(JSON.stringify(res, null, 2)))
//   .catch((e) => console.error('caught', e))
