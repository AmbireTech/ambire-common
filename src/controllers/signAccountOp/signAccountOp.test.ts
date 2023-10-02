import { JsonRpcProvider } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { networks } from '../../consts/networks'
import { Account, AccountStates } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { getAccountState } from '../../libs/accountState/accountState'
import { estimate } from '../../libs/estimate/estimate'
import { getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { KeystoreController } from '../keystore/keystore'
import { PortfolioController } from '../portfolio/portfolio'
import { SignAccountOpController, SigningStatus } from './signAccountOp'

const providers = Object.fromEntries(
  networks.map((network) => [network.id, new JsonRpcProvider(network.rpcUrl)])
)

const getAccountsInfo = async (accounts: Account[]): Promise<AccountStates> => {
  const result = await Promise.all(
    networks.map((network) => getAccountState(providers[network.id], network, accounts))
  )
  const states = accounts.map((acc: Account, accIndex: number) => {
    return [
      acc.addr,
      Object.fromEntries(
        networks.map((network: NetworkDescriptor, netIndex: number) => {
          return [network.id, result[netIndex][accIndex]]
        })
      )
    ]
  })
  return Object.fromEntries(states)
}

// @TODO - copied from keystore signer tests. Should reuse.
class InternalSigner {
  key

  privKey

  constructor(_key: Key, _privKey?: string) {
    this.key = _key
    this.privKey = _privKey
  }

  signRawTransaction() {
    return Promise.resolve('0x010101')
  }

  signTypedData() {
    return Promise.resolve('')
  }

  signMessage() {
    return Promise.resolve('0x010101')
  }
}

// @TODO - copied from estimate tests. Should reuse.
const createAccountOp = (signingKeyAddr: string) => {
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

  const tomorrowHex = Math.floor((Date.now() + 86400000) / 1000).toString(16)
  // 64 chars expire hex
  // we set swap deadline always for tomorrow, in order to prevent the test failure with 'TRANSACTION TOO OLD'
  const expire = '0'.repeat(64 - tomorrowHex.length) + tomorrowHex

  // USDT -> USDC swap
  // Fee tokens: USDT, USDC
  const data = `0x5ae401dc${expire}00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000a07d75aacefd11b425af7181958f0f85c312f14300000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000c33d9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`

  // const SPOOF_SIGTYPE = '03'
  // const spoofSig =
  //   new AbiCoder().encode(['address'], ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E']) +
  //   SPOOF_SIGTYPE

  const nativeToCheck = [
    '0x0000000000000000000000000000000000000001',
    '0x942f9CE5D9a33a82F88D233AEb3292E680230348'
  ]
  const feeTokens = [
    '0x0000000000000000000000000000000000000000',
    '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  ]

  const op = {
    accountAddr: account.addr,
    signingKeyAddr,
    signingKeyType: 'internal' as any,
    gasLimit: null,
    gasFeePayment: null,
    networkId: 'ethereum',
    nonce: null, // does not matter when estimating
    calls: [{ to, value: BigInt(0), data }],
    accountOpToExecuteBefore: null,
    signature: null
  }

  return { op, account, nativeToCheck, feeTokens }
}

describe('SignAccountOp Controller ', () => {
  test('it sets GasFeePayment and signs the AccountOp', async () => {
    const privKey = '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
    const keyPublicAddress = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'
    const pass = 'testpass'

    const keystore = new KeystoreController(produceMemoryStore(), { internal: InternalSigner })
    await keystore.addSecret('passphrase', pass, '', false)
    await keystore.unlockWithSecret('passphrase', pass)
    await keystore.addKeys([{ privateKey: privKey, label: keyPublicAddress }])

    const ethereum = networks.find((x) => x.id === 'ethereum')!
    const provider = new JsonRpcProvider(ethereum!.rpcUrl)
    const prices = await getGasPriceRecommendations(provider)

    const { op, account, nativeToCheck, feeTokens } = createAccountOp(keyPublicAddress)
    const estimation = await estimate(provider, ethereum, account, op, nativeToCheck, feeTokens)
    const accounts = [account]
    const accountStates = await getAccountsInfo(accounts)
    const portfolio = new PortfolioController(
      produceMemoryStore(),
      'https://staging-relayer.ambire.com',
      []
    )
    const controller = new SignAccountOpController(keystore, portfolio)
    controller.status = { type: SigningStatus.ReadyToSign }

    controller.updateMainDeps({
      accounts,
      networks,
      accountStates
    })

    controller.update({
      accountOp: op,
      gasPrices: prices,
      estimation,
      feeTokenAddr: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      paidBy: account.addr
    })

    await controller.sign()

    console.log(controller)

    expect(controller.accountOp?.gasFeePayment?.amount).toBeGreaterThan(21000n)
    expect(controller.accountOp?.signature).toEqual('0x010101')
    expect(controller.status).toEqual({ type: 'done' })
  })
})
