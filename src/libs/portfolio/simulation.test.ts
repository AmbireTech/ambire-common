import { Contract, Interface, ZeroAddress } from 'ethers'
import fetch from 'node-fetch'

import { describe, expect, test } from '@jest/globals'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import BalanceGetter from '../../../contracts/compiled/BalanceGetter.json'
import { velcroUrl } from '../../../test/config'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { Account } from '../../interfaces/account'
import { getRpcProvider } from '../../services/provider'
import { getBaseAccount } from '../account/getBaseAccount'
import { AccountOp } from '../accountOp/accountOp'
import { getAccountState } from '../accountState/accountState'
import { ERC20 } from '../humanizer/const/abis'
import { Portfolio } from './portfolio'

const ACCOUNT_ADDR = '0xD8293ad21678c6F09Da139b4B62D38e514a03B78'
const RECIPIENT_ADDR = '0xe5a4dad2ea987215460379ab285df87136e83bea'
const DEPLOYLESS_ADDR = '0x0000000000000000000000000000000000696969'
const BASE_LIFI_INVALID_TOKEN = '0x6d691Fb41CA5f030422251BCb19944bd8D8CB094'.toLowerCase()

const TOKENS = [
  {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'USDT',
    name: 'Tether USD'
  },
  {
    address: '0xADE00C28244d5CE17D72E40330B1c318cD12B7c3',
    symbol: 'ADX',
    name: 'AdEx Network'
  },
  {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    name: 'USD Coin'
  }
]

// a token list which previously, the simulation reverted with
// out of gas with. Now, it should pass
const BASE_LIFI_CURL_TOKEN_HINTS = [
  BASE_LIFI_INVALID_TOKEN,
  '0xD8293ad21678c6F09Da139b4B62D38e514a03B78',
  '0xa860498F8a299526174b539FcC49F13cc082Fb18',
  '0x31a9b1835864706AF10103b31Ea2b79bDb995f5F',
  '0xc87De04e2EC1F4282Dff2933a2d58199F688Fc3d',
  '0x9eaaabE267A8B3c1ba081A2866FA9EA22f84680D',
  '0x21CFCFc3D8F98Fc728f48341D10Ad8283f6Eb7aB',
  '0x48b3e8510d6C43B109960cc56D2C27A72e19fDb4',
  '0x88fb150bDc53A65Fe94dea0c9BA0a6DaF8c6e196',
  '0xd98B11D2b6012509FaDa6DaEa61B383cFA8E2DB3',
  '0x5F980dcFC4c0fA3911554CF5AB288ed0eb13dBA3',
  '0x44494CBC6eae9406D2Cc6462fA4e8Fb665329578',
  '0xd433B339C5C801228E1343c678Dc26213A7b8aac',
  '0x1fae246b1b2d0cE47126bBb109850DA355352d77',
  '0x01E194C3007B88cF4D5dd490877E87239422899A',
  '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
  '0x833589fCD6eDb6E08f4c7C32D4f71b54BDA02913',
  '0x4200000000000000000000000000000000000006',
  '0xbbBeAd62F7647Ae8323d2CB243A0DB74b7C2B800',
  '0x26C69e4924BD0D7D52d680b33616042ee13F621c',
  '0x6bB7a212910682dCfdBd5BCBb3e28fB4e8Da10EE',
  '0xCbb7C0000aB88B473b1f5AFD9ef808440eed33Bf',
  '0xBdb9300B7cDe636d9cD4aff00f6F009fFbBc8ee6',
  '0x59DcA05B6C26DBd64b5381374aaAC5CD05644C28',
  '0x63706e401c06ac8513145b7687A14804d17f814b',
  '0x4158734D47fc9692176B5085e0F52EE0da5d47F1',
  '0x311935Cd80b76769Bf2EcC9D8AB7635B2139Cf82',
  '0x3B86Ad95859b6AB773f55f8D94B4b9D443EE931f',
  '0x47636b3188774a3E7273D85A537B9Ba4Ee7B2535',
  '0x9d0e8f5b25384C7310Cb8C6AE32C8fBEb645D083',
  '0xEC92788B0aDE17D0D57B2E47A1D0afd0735a5C61',
  '0x4e65fE4DbA92790696D040ac24Aa414708F5c0AB',
  '0xD4dd9E2F021Bb459d5a5f6C24c12fE09C5d45553',
  '0xbaa5CC21fD487B8Fcc2F632f3F4E8D37262A0842',
  '0x2E6c4bd1C947E195645d2B920B827498cFAa6766',
  '0xe4B20925D9e9A62f1e492E15A81dC0De62804dd4',
  '0xc0041Ef357b183448B235a8Ea73Ce4E4Ec8c265F',
  ZeroAddress,
  '0xd9aaEc86B65d86F6A7B5B1b0c42FfA531710b6CA',
  '0xC1cba3FcEA344f92D9239C08c0568f6F2F0ee452',
  '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c',
  '0x60a3e35cc302Bfa44CB288BC5A4F316FdB1ADB42'
].map((address) => address.toLowerCase())

describe('Portfolio simulation', () => {
  const ethereum = networks.find((n) => n.chainId === 1n)
  if (!ethereum) throw new Error('unable to find ethereum network in consts')

  const provider = getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)
  const portfolio = new Portfolio(fetch, provider, ethereum, velcroUrl)
  const balanceGetterInterface = new Interface(BalanceGetter.abi)

  async function getNonce(address: string) {
    const accountContract = new Contract(address, AmbireAccount.abi, provider)

    try {
      return await accountContract.nonce!()
    } catch (e) {
      return 0n
    }
  }

  test('simulates decreasing balances for USDT, ADX and USDC transfers from an EOA', async () => {
    const account: Account = {
      addr: ACCOUNT_ADDR,
      associatedKeys: [ACCOUNT_ADDR],
      creation: null,
      initialPrivileges: [],
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: ACCOUNT_ADDR
      }
    }

    const accountStatesResult = await getAccountState(provider, ethereum, [account], [])
    const accountState = accountStatesResult[0]
    if (!accountState) throw new Error('Account state not found')

    const calls = await Promise.all(
      TOKENS.map(async ({ address }) => {
        const tokenContract = new Contract(address, ERC20, provider)
        const decimals = await tokenContract.decimals!()
        const amount = 10n ** BigInt(decimals) / 1000n
        const balance = await tokenContract.balanceOf!(ACCOUNT_ADDR)

        expect(balance).toBeGreaterThan(amount)

        return {
          amount,
          call: {
            to: address,
            value: 0n,
            data: tokenContract.interface.encodeFunctionData('transfer', [RECIPIENT_ADDR, amount])
          }
        }
      })
    )

    const accountOp: AccountOp = {
      accountAddr: ACCOUNT_ADDR,
      signingKeyAddr: ACCOUNT_ADDR,
      gasLimit: null,
      gasFeePayment: null,
      chainId: 1n,
      nonce: await getNonce(ACCOUNT_ADDR),
      signature: '0x',
      calls: calls.map(({ call }) => call),
      signingKeyType: 'internal',
      id: 'test'
    }

    const postSimulation = await portfolio.get(ACCOUNT_ADDR, {
      additionalErc20Hints: TOKENS.map(({ address }) => address),
      disableAutoDiscovery: true,
      fetchPinned: false,
      simulation: {
        accountOps: [accountOp],
        baseAccount: getBaseAccount(account, accountState, ethereum),
        state: accountState
      }
    })

    TOKENS.forEach(({ address, symbol, name }, index) => {
      const token = postSimulation.tokens.find((t) => t.address === address)
      const amount = calls[index]!.amount

      if (!token) throw new Error(`${symbol} not found in simulation result`)

      expect(token.symbol).toBe(symbol)
      expect(token.name).toBe(name)
      expect(token.decimals).toBeGreaterThan(0)
      expect(token.amountPostSimulation).toBe(token.amount - amount)
      expect(token.simulationAmount).toBe(-amount)
    })
  })

  test('runs the failing Base LI.FI deployless eth_call without reverting', async () => {
    const baseProvider = getRpcProvider(['https://invictus.ambire.com/base'], 8453n)
    const erc20Interface = new Interface(ERC20)
    const callData = balanceGetterInterface.encodeFunctionData('simulateAndGetBalances', [
      ACCOUNT_ADDR,
      [ACCOUNT_ADDR],
      BASE_LIFI_CURL_TOKEN_HINTS,
      ZeroAddress,
      '0x',
      [
        {
          nonce: 0n,
          txns: [
            {
              to: '0x4200000000000000000000000000000000000006',
              value: 0n,
              data: erc20Interface.encodeFunctionData('balanceOf', [ACCOUNT_ADDR])
            }
          ]
        }
      ]
    ])

    const result = await baseProvider.send('eth_call', [
      {
        to: DEPLOYLESS_ADDR,
        data: callData,
        from: '0x0000000000000000000000000000000000000001'
      },
      'latest',
      {
        [DEPLOYLESS_ADDR]: {
          code: BalanceGetter.binRuntime
        }
      }
    ])

    const [before, afterSimulation, simulationError, gasLeft] =
      balanceGetterInterface.decodeFunctionResult('simulateAndGetBalances', result)

    expect(result).toMatch(/^0x/)
    expect(before.balances).toHaveLength(BASE_LIFI_CURL_TOKEN_HINTS.length)
    expect(
      before.balances[BASE_LIFI_CURL_TOKEN_HINTS.indexOf(BASE_LIFI_INVALID_TOKEN)].error
    ).not.toBe('0x')
    expect(afterSimulation.nonce).toBeGreaterThan(before.nonce)
    expect(simulationError).toBe('0x')
    expect(gasLeft).toBeGreaterThan(0n)
  })
})
