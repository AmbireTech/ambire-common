import fetch from 'node-fetch'
import { AbiCoder, ethers, JsonRpcProvider } from 'ethers'
import { describe, expect, test, jest } from '@jest/globals'
import { Portfolio } from './portfolio'
import { networks } from '../../consts/networks'
import { AmbireAccount } from '../../../test/config'

describe('Portfolio', () => {
  const ethereum = networks.find((x) => x.id === 'ethereum')
  if (!ethereum) throw new Error('unable to find ethereum network in consts')
  const provider = new JsonRpcProvider(ethereum.rpcUrl)
  const portfolio = new Portfolio(fetch, provider, ethereum)

  async function getNonce(address: string) {
    const accountContract = new ethers.Contract(address, AmbireAccount.abi, provider)
    return accountContract.nonce()
  }

  test('batching works', async () => {
    const [resultOne, resultTwo, resultThree] = await Promise.all([
      portfolio.get('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'),
      portfolio.get('0x8F493C12c4F5FF5Fd510549E1e28EA3dD101E850'),
      portfolio.get('0x62d00bf1f291be434AC01b3Dc75fA84Af963370A')
    ])

    expect(Math.abs(resultOne.discoveryTime - resultTwo.discoveryTime)).toBeLessThanOrEqual(5)
    expect(Math.abs(resultOne.oracleCallTime - resultTwo.oracleCallTime)).toBeLessThanOrEqual(5)
    expect(Math.abs(resultOne.priceUpdateTime - resultTwo.priceUpdateTime)).toBeLessThanOrEqual(5)

    expect(Math.abs(resultOne.discoveryTime - resultThree.discoveryTime)).toBeLessThanOrEqual(5)
    expect(Math.abs(resultOne.oracleCallTime - resultThree.oracleCallTime)).toBeLessThanOrEqual(5)
    expect(Math.abs(resultOne.priceUpdateTime - resultThree.priceUpdateTime)).toBeLessThanOrEqual(5)
  })

  test('token simulation', async () => {
    const accountOp = {
      accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      signingKeyAddr: '0xe5a4Dad2Ea987215460379Ab285DF87136E83BEA',
      gasLimit: null,
      gasFeePayment: null,
      network: { chainId: 0, name: 'ethereum' },
      nonce: 6,
      signature: '0x000000000000000000000000e5a4Dad2Ea987215460379Ab285DF87136E83BEA03',
      calls: [
        {
          to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          value: BigInt(0),
          data: '0xa9059cbb000000000000000000000000e5a4dad2ea987215460379ab285df87136e83bea00000000000000000000000000000000000000000000000000000000005040aa'
        }
      ]
    }
    const account = {
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      label: '',
      pfp: '',
      associatedKeys: [],
      factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
      bytecode:
        '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
      salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
    }
    const postSimulation = await portfolio.get('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8', {
      simulation: { accountOps: [accountOp], account }
    })
    const entry = postSimulation.tokens.find((x) => x.symbol === 'USDC')

    if (!entry || entry.amountPostSimulation === undefined) {
      throw new Error('Token not found or `amountPostSimulation` is not calculated')
    }

    expect(entry.amount - entry.amountPostSimulation).toBe(5259434n)
  })

  test('nft simulation', async () => {
    const ABI = ['function transferFrom(address from, address to, uint256 tokenId)']
    const iface = new ethers.Interface(ABI)
    const data = iface.encodeFunctionData('transferFrom', [
      '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      137
    ])

    const SPOOF_SIGTYPE = '03'
    const spoofSig =
      new AbiCoder().encode(['address'], ['0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175']) +
      SPOOF_SIGTYPE

    const accountOp = {
      accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
      gasLimit: null,
      gasFeePayment: null,
      network: { chainId: 0, name: 'ethereum' },
      nonce: await getNonce('0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'),
      signature: spoofSig,
      calls: [{ to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0', value: BigInt(0), data }]
    }
    const account = {
      addr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      label: '',
      pfp: '',
      associatedKeys: [],
      factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
      bytecode:
        '0x7f00000000000000000000000000000000000000000000000000000000000000017fc00d23fd13e6cc01978ac25779646c3ba8aa974211c51a8b0f257a4593a6b7d3553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
      salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
    }

    const postSimulation = await portfolio.get('0xB674F3fd5F43464dB0448a57529eAF37F04cceA5', {
      simulation: { accountOps: [accountOp], account }
    })

    const collection = postSimulation.collections.find((c) => c.symbol === 'NFT Fiesta')

    if (!collection || collection.amountPostSimulation === undefined) {
      throw new Error('Collection not found or `amountPostSimulation` is not calculated')
    }

    expect(collection.amount - collection.amountPostSimulation).toBe(1n)
  })

  test('price cache works', async () => {
    const { priceCache } = await portfolio.get('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')
    const resultTwo = await portfolio.get('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8', {
      priceCache,
      priceRecency: 60000
    })
    expect(resultTwo.priceUpdateTime).toBeLessThanOrEqual(3)
    expect(resultTwo.tokens.every((x) => x.priceIn.length)).toBe(true)
  })

  test('portfolio works with previously cached hints, even if Velcro Discovery request fails', async () => {
    // Here we are mocking multi-hints route only, in order to simulate Velcro Discovery failure
    jest.mock('node-fetch', () => {
      return jest.fn((url) => {
        // @ts-ignore
        const { Response } = jest.requireActual('node-fetch')
        if (url.includes('https://relayer.ambire.com/velcro-v3/multi-hints')) {
          const body = JSON.stringify({ message: 'API error' })
          const headers = { status: 200 }

          return Promise.resolve(new Response(body, headers))
        }

        // @ts-ignore
        return jest.requireActual('node-fetch')(url)
      })
    })

    const portfolio = new Portfolio(fetch, provider, ethereum)
    const previousHints = {
      erc20s: [
        '0x0000000000000000000000000000000000000000',
        '0xba100000625a3754423978a60c9317c58a424e3D',
        '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      ],
      erc721s: {}
    }
    const result = await portfolio.get('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8', {
      previousHints
    })

    // Restore node-fetch module
    jest.mock('node-fetch', () => {
      return jest.fn().mockImplementation(jest.requireActual('node-fetch'))
    })

    expect(result.tokens.map((token) => token.address)).toEqual(previousHints.erc20s)
    // Portfolio should determine the tokens' balances and prices
    // @ts-ignore
    expect(result.total.usd).toBeGreaterThan(100)
  })
})
