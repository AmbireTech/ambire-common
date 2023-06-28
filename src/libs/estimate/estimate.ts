import { Provider, JsonRpcProvider } from 'ethers'
import { fromDescriptor, parseErr } from '../deployless/deployless'
import { getAccountDeployParams } from '../account/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { AccountOp, callToTuple } from '../accountOp/accountOp'
import { Account } from '../../interfaces/account'
import estimator from './estimator.json'

// @TODO test
// USDT -> USDC swap
// Fee tokens: USDT, USDC
import { networks } from '../../consts/networks'

// @TODO return type
export async function estimate(
  provider: Provider,
  network: NetworkDescriptor,
  acc: Account,
  op: AccountOp,
  blockTag: string | number = 'latest'
): Promise<any> {
  // @ TODO implement EOAs
  if (!acc.creation) throw new Error('EOA not supported yet')
  const deploylessEstimator = fromDescriptor(provider, estimator, !network.rpcNoStateOverride)

  // @TODO this is temp
  const nativeToCheck = [
    '0x0000000000000000000000000000000000000001',
    '0x942f9CE5D9a33a82F88D233AEb3292E680230348'
  ]
  const feeTokens: string[] = [
    '0x0000000000000000000000000000000000000000',
    '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
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
  const [estimationResult] = await deploylessEstimator.call('estimate', args, {
    from: '0x0000000000000000000000000000000000000001',
    blockTag
  })
  return estimationResult
}

const ethereum = networks.find((x) => x.id === 'ethereum')
if (!ethereum) throw new Error('no eth')
const provider = new JsonRpcProvider(ethereum.rpcUrl)

const account = {
  addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
  label: '',
  pfp: '',
  associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
  creation: {
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f28d4ea8f825adb036e9b306b2269570e63d2aa5bd10751437d98ed83551ba1cd7fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
  }
}
const to = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'
// Expired data
// const data = '0x5ae401dc00000000000000000000000000000000000000000000000000000000648eaffb00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000000000000000000000000000000000064000000000000000000000000a07d75aacefd11b425af7181958f0f85c312f1430000000000000000000000000000000000000000000000000000000005f5e1000000000000000000000000000000000000000000000000000000000005e587c3000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
const data =
  '0x5ae401dc00000000000000000000000000000000000000000000000000000000648f9f0b00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000000000000000000000000000000000064000000000000000000000000a07d75aacefd11b425af7181958f0f85c312f1430000000000000000000000000000000000000000000000000000000005f5e1000000000000000000000000000000000000000000000000000000000005e5d981000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
const op = {
  accountAddr: account.addr,
  signingKeyAddr: null,
  gasLimit: null,
  gasFeePayment: null,
  networkId: 'ethereum',
  nonce: null, // does not matter when estimating
  signature: null,
  calls: [{ to, value: BigInt(0), data }],
  accountOpToExecuteBefore: null
}

estimate(provider, ethereum, account, op)
  .then(console.log)
  .catch((e) => console.error('caught', e))
