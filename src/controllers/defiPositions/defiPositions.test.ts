/* eslint-disable @typescript-eslint/no-use-before-define */
import fetch from 'node-fetch'

import { produceMemoryStore } from '../../../test/helpers'
import { StorageController } from '../storage/storage'
import { DefiPositionsController } from './defiPositions'

global.fetch = fetch as any

// If the account ever has to be replaced:
// 1. Go to https://debank.com/protocols
// 2. Find an Account that has both Aave v3 and Uniswap v3 positions on mainnet
// 3. Replace the address below with that account's address
// 4. Update the static MOCK_DEBANK_RESPONSE_DATA below with a fresh call to cena
const ACCOUNT = {
  addr: '0x96c122e9c968e8246288c724838b1924410807fb',
  initialPrivileges: [],
  associatedKeys: ['0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175'],
  creation: {
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
  },
  preferences: {
    label: 'Test account',
    pfp: '0x96c122e9c968e8246288c724838b1924410807fb'
  }
}

const prepareTest = async () => {
  const storage = produceMemoryStore()
  await storage.set('accounts', [ACCOUNT])
  const storageCtrl = new StorageController(storage)

  const controller = new DefiPositionsController(fetch, storageCtrl)

  return {
    controller,
    storage
  }
}

describe('DefiPositionsController', () => {
  it('getUniqueMergedPositions: duplicates are removed and custom are preferred', async () => {
    const uniV3 = MOCK_DEBANK_RESPONSE_DATA.find(
      (p) => p.providerName === 'Uniswap V3' && p.chainId === 1
    )!

    const customUni = {
      ...uniV3,
      source: 'custom' as const
    }

    const merged = DefiPositionsController.getUniqueMergedPositions(
      MOCK_DEBANK_RESPONSE_DATA.filter(({ chainId }) => chainId === 1) as any[],
      [customUni] as any[],
      null
    )

    expect(merged.length).toBe(
      MOCK_DEBANK_RESPONSE_DATA.filter(({ chainId }) => chainId === 1).length
    )
    const mergedUni = merged.find((p) => p.providerName === 'Uniswap V3')!
    expect(mergedUni.source).toBe('custom')
  })
})

const MOCK_DEBANK_RESPONSE_DATA = [
  {
    providerName: '1inch',
    chainId: 1,
    iconUrl:
      'https://static.debank.com/image/project/logo_url/1inch2/440a1f1dd2b4762cd615bd1e5669afa8.png',
    siteUrl: 'https://1inch.com',
    type: 'common',
    positions: [
      {
        id: '9ca11f3e-f43e-4f47-b987-285242bb6109',
        assets: [
          {
            address: '0x111111111117dc0aa78b770fa6a738034120c302',
            symbol: '1INCH',
            name: '1INCH Token',
            decimals: 18,
            amount: '1387564909315267493888',
            priceIn: { price: 0.1577, baseCurrency: 'usd' },
            value: 218.81898619901767,
            type: 1,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x111111111117dc0aa78b770fa6a738034120c302/2583e21fd1e1b0c9553cc692aa5720e0.png'
          }
        ],
        additionalData: {
          positionInUSD: 218.81898619901767,
          collateralInUSD: 218.81898619901767,
          name: 'Rewards',
          detailTypes: ['common'],
          updateAt: 1765987276,
          pool: {
            id: '0x9278b0c6eeac0589c4983d5843dd44134de8765f',
            chain: 'eth',
            project_id: '1inch2',
            adapter_id: 'oneinch_reward',
            controller: '0x9278b0c6eeac0589c4983d5843dd44134de8765f',
            index: null,
            time_at: 1716558515
          }
        }
      },
      {
        id: '7d7e161f-5554-46d4-b39d-ae54a951e79c',
        assets: [
          {
            address: '0x111111111117dc0aa78b770fa6a738034120c302',
            symbol: '1INCH',
            name: '1INCH Token',
            decimals: 18,
            amount: '1487725829898755589013504',
            priceIn: { price: 0.1577, baseCurrency: 'usd' },
            value: 234614.36337503375,
            type: 1,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x111111111117dc0aa78b770fa6a738034120c302/2583e21fd1e1b0c9553cc692aa5720e0.png'
          }
        ],
        additionalData: {
          positionInUSD: 234614.36337503375,
          collateralInUSD: 234614.36337503375,
          name: 'Locked',
          detailTypes: ['locked'],
          updateAt: 1765987276,
          pool: {
            id: '0x9a0c8ff858d273f57072d714bca7411d717501d7',
            chain: 'eth',
            project_id: '1inch2',
            adapter_id: 'oneinch_locked',
            controller: '0x9a0c8ff858d273f57072d714bca7411d717501d7',
            index: null,
            time_at: 1671729563
          }
        }
      }
    ],
    positionInUSD: 234833.18236123276
  },
  {
    providerName: 'Aave V3',
    chainId: 1,
    iconUrl:
      'https://static.debank.com/image/project/logo_url/aave3/54df7839ab09493ba7540ab832590255.png',
    siteUrl: 'https://app.aave.com',
    type: 'lending',
    positions: [
      {
        id: 'ce3d3a4e-5170-43e4-85f4-f43a7eb3fcd2',
        assets: [
          {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            amount: '2771020279209',
            priceIn: { price: 1.0004001600640255, baseCurrency: 'usd' },
            value: 2772129.1308613443,
            type: 1,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/fffcd27b9efff5a86ab942084c05924d.png',
            protocolAsset: { address: '0x2a1fbcb52ed4d9b23dad17e1e8aed4bb0e6079b8' }
          },
          {
            address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
            symbol: 'USDT',
            name: 'Tether USD',
            decimals: 6,
            amount: '50034943768',
            priceIn: { price: 0.99967, baseCurrency: 'usd' },
            value: 50018.43223655655,
            type: 1,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xdac17f958d2ee523a2206206994597c13d831ec7/1a1d8a5b89114dc183f42b3d33eb3522.png',
            protocolAsset: { address: '0x23878914efe38d27c4d67ab83ed1b93a74d4086a' }
          }
        ],
        additionalData: {
          healthRate: 1.157920892373162e59,
          positionInUSD: 2822147.5630979007,
          collateralInUSD: 2822147.5630979007,
          name: 'Lending',
          detailTypes: ['lending'],
          updateAt: 1765987276,
          pool: {
            id: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
            chain: 'eth',
            project_id: 'aave3',
            adapter_id: 'aave3_proxy_lending',
            controller: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
            index: null,
            time_at: 1672325495
          }
        }
      }
    ],
    positionInUSD: 2822147.5630979007
  },
  {
    providerName: 'Uniswap V3',
    chainId: 1,
    iconUrl:
      'https://static.debank.com/image/project/logo_url/uniswap3/87a541b3b83b041c8d12119e5a0d19f0.png',
    siteUrl: 'https://app.uniswap.org',
    type: 'common',
    positions: [
      {
        id: '0e7f6d0d-2878-4222-9239-fe9df840b5d2',
        assets: [
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '0',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 0,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xcb1592591996765ec0efc1f92599a19767ee5ffa',
            symbol: 'BIO',
            name: 'BIO',
            decimals: 18,
            amount: '737084280279086563065856',
            priceIn: { price: 0.0444, baseCurrency: 'usd' },
            value: 32726.542044391445,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xcb1592591996765ec0efc1f92599a19767ee5ffa/33f811558c01651b11a7e8999d440d8c.png'
          }
        ],
        additionalData: {
          positionInUSD: 32726.542044391445,
          collateralInUSD: 32726.542044391445,
          positionIndex: '1089347',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1089347',
          pool: {
            id: '0x08a5a1e2671839dadc25e2e20f9206fd33c88092',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x08a5a1e2671839dadc25e2e20f9206fd33c88092',
            index: null,
            time_at: 1734959171
          }
        }
      },
      {
        id: 'bce76877-726d-4c48-89fe-71cf6c60e176',
        assets: [
          {
            address: '0x643c4e15d7d62ad0abec4a9bd4b001aa3ef52d66',
            symbol: 'SYRUP',
            name: 'Syrup Token',
            decimals: 18,
            amount: '115677976187180259737600',
            priceIn: { price: 0.2854, baseCurrency: 'usd' },
            value: 33014.49440382125,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x643c4e15d7d62ad0abec4a9bd4b001aa3ef52d66/7b432986ceca8eb93240a2054e3412d3.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '10963611642645657600',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 31936.891078910372,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0x643c4e15d7d62ad0abec4a9bd4b001aa3ef52d66',
            symbol: 'SYRUP',
            name: 'Syrup Token',
            decimals: 18,
            amount: '1650334900729992708096',
            priceIn: { price: 0.2854, baseCurrency: 'usd' },
            value: 471.0055806683399,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x643c4e15d7d62ad0abec4a9bd4b001aa3ef52d66/7b432986ceca8eb93240a2054e3412d3.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '182134741011570912',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 530.5566792192959,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 65952.94774261926,
          collateralInUSD: 65952.94774261926,
          positionIndex: '1085046',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1085046',
          pool: {
            id: '0x27941a235804f33d81adabb2d56589c5f6ea6556',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x27941a235804f33d81adabb2d56589c5f6ea6556',
            index: null,
            time_at: 1730913887
          }
        }
      },
      {
        id: 'f1eb2aac-4c9a-4169-8619-f0565b1f7778',
        assets: [
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '0',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 0,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xd1d2eb1b1e90b638588728b4130137d262c87cae',
            symbol: 'GALA',
            name: 'Gala',
            decimals: 8,
            amount: '1336118841650333',
            priceIn: { price: 0.00654, baseCurrency: 'usd' },
            value: 87382.17224393181,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xd1d2eb1b1e90b638588728b4130137d262c87cae/0587a505b6c1cd4620722002ecc4d567.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '15400910618109370',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 44.86269862144641,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xd1d2eb1b1e90b638588728b4130137d262c87cae',
            symbol: 'GALA',
            name: 'Gala',
            decimals: 8,
            amount: '385502122618',
            priceIn: { price: 0.00654, baseCurrency: 'usd' },
            value: 25.2118388192172,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xd1d2eb1b1e90b638588728b4130137d262c87cae/0587a505b6c1cd4620722002ecc4d567.png'
          }
        ],
        additionalData: {
          positionInUSD: 87452.24678137248,
          collateralInUSD: 87452.24678137248,
          positionIndex: '1038855',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1038855',
          pool: {
            id: '0x465e56cd21ad47d4d4790f17de5e0458f20c3719',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x465e56cd21ad47d4d4790f17de5e0458f20c3719',
            index: null,
            time_at: 1684207871
          }
        }
      },
      {
        id: '14eb7427-4f4b-4a1e-a964-0c95c3f05c07',
        assets: [
          {
            address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
            symbol: 'AAVE',
            name: 'Aave Token',
            decimals: 18,
            amount: '185551884462498414592',
            priceIn: { price: 184.36632165460136, baseCurrency: 'usd' },
            value: 34209.51841443041,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9/7baf403c819f679dc1c6571d9d978f21.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '13756744954592729088',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 40073.260485279076,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
            symbol: 'AAVE',
            name: 'Aave Token',
            decimals: 18,
            amount: '74663575457206800',
            priceIn: { price: 184.36632165460136, baseCurrency: 'usd' },
            value: 13.765448768625989,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9/7baf403c819f679dc1c6571d9d978f21.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '3799731208161841',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 11.06857901206336,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 74307.61292749018,
          collateralInUSD: 74307.61292749018,
          positionIndex: '1108150',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1108150',
          pool: {
            id: '0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb',
            index: null,
            time_at: 1620236624
          }
        }
      },
      {
        id: '233a7b5c-8e80-439d-8930-143c25e1338c',
        assets: [
          {
            address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
            symbol: 'AAVE',
            name: 'Aave Token',
            decimals: 18,
            amount: '142785321408509935616',
            priceIn: { price: 184.36632165460136, baseCurrency: 'usd' },
            value: 26324.80449435698,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9/7baf403c819f679dc1c6571d9d978f21.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '19593751257096159232',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 57076.401474408536,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
            symbol: 'AAVE',
            name: 'Aave Token',
            decimals: 18,
            amount: '2598507269473949696',
            priceIn: { price: 184.36632165460136, baseCurrency: 'usd' },
            value: 479.0772270656541,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9/7baf403c819f679dc1c6571d9d978f21.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '166987124808128544',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 486.43182469483037,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 84366.715020526,
          collateralInUSD: 84366.715020526,
          positionIndex: '1121754',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1121754',
          pool: {
            id: '0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb',
            index: null,
            time_at: 1620236624
          }
        }
      },
      {
        id: 'c24522e8-ea6e-4ecf-a48c-c5299befbff7',
        assets: [
          {
            address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
            symbol: 'AAVE',
            name: 'Aave Token',
            decimals: 18,
            amount: '292738391110740049920',
            priceIn: { price: 184.36632165460136, baseCurrency: 'usd' },
            value: 53971.1003761732,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9/7baf403c819f679dc1c6571d9d978f21.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '17628059176595417088',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 51350.36010083068,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
            symbol: 'AAVE',
            name: 'Aave Token',
            decimals: 18,
            amount: '3248836374319705600',
            priceIn: { price: 184.36632165460136, baseCurrency: 'usd' },
            value: 598.9760119909957,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9/7baf403c819f679dc1c6571d9d978f21.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '208542023947607872',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 607.4808303391422,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 106527.91731933402,
          collateralInUSD: 106527.91731933402,
          positionIndex: '1089328',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1089328',
          pool: {
            id: '0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb',
            index: null,
            time_at: 1620236624
          }
        }
      },
      {
        id: '54c03073-a2be-4279-87ce-497bd06fa65c',
        assets: [
          {
            address: '0x56072c95faa701256059aa122697b133aded9279',
            symbol: 'SKY',
            name: 'SKY Governance Token',
            decimals: 18,
            amount: '662077690691710894473216',
            priceIn: { price: 0.05963360111427782, baseCurrency: 'usd' },
            value: 39482.0769133717,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x56072c95faa701256059aa122697b133aded9279/6ee24b04e01abbd4f2ace465a430fad4.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '33629041677477273600',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 97961.06211607452,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0x56072c95faa701256059aa122697b133aded9279',
            symbol: 'SKY',
            name: 'SKY Governance Token',
            decimals: 18,
            amount: '8389664156661366915072',
            priceIn: { price: 0.05963360111427782, baseCurrency: 'usd' },
            value: 500.305885801098,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x56072c95faa701256059aa122697b133aded9279/6ee24b04e01abbd4f2ace465a430fad4.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '183688911735091264',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 535.0839629952034,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 138478.5288782425,
          collateralInUSD: 138478.5288782425,
          positionIndex: '1086822',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1086822',
          pool: {
            id: '0x764510ab1d39cf300e7abe8f5b8977d18f290628',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x764510ab1d39cf300e7abe8f5b8977d18f290628',
            index: null,
            time_at: 1727475131
          }
        }
      },
      {
        id: 'e77047de-2735-40a5-8b98-75ec6d27b717',
        assets: [
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '3062629466510980096',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 8921.40900965182,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3',
            symbol: 'ONDO',
            name: 'Ondo',
            decimals: 18,
            amount: '170292337916480596213760',
            priceIn: { price: 0.40433284123209967, baseCurrency: 'usd' },
            value: 68854.78482982742,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3/5afbedf06f5827e346deada3dc7d7c39.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '39043578987035864',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 113.7335551534456,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3',
            symbol: 'ONDO',
            name: 'Ondo',
            decimals: 18,
            amount: '374822290381020594176',
            priceIn: { price: 0.40433284123209967, baseCurrency: 'usd' },
            value: 151.55296162688117,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3/5afbedf06f5827e346deada3dc7d7c39.png'
          }
        ],
        additionalData: {
          positionInUSD: 78041.48035625956,
          collateralInUSD: 78041.48035625956,
          positionIndex: '1132210',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1132210',
          pool: {
            id: '0x7b1e5d984a43ee732de195628d20d05cfabc3cc7',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x7b1e5d984a43ee732de195628d20d05cfabc3cc7',
            index: null,
            time_at: 1705581071
          }
        }
      },
      {
        id: 'ac93e192-ad79-42d9-be8c-7b7982d3f5d6',
        assets: [
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '3542348357110454272',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 10318.825340779182,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xd533a949740bb3306d119cc777fa900ba034cd52',
            symbol: 'CRV',
            name: 'Curve DAO Token',
            decimals: 18,
            amount: '130567243621280639877120',
            priceIn: { price: 0.357, baseCurrency: 'usd' },
            value: 46612.50597279718,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xd533a949740bb3306d119cc777fa900ba034cd52/4a3b2aa9775c79867db769e3bed76e83.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '40224534040618240',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 117.1736654149805,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xd533a949740bb3306d119cc777fa900ba034cd52',
            symbol: 'CRV',
            name: 'Curve DAO Token',
            decimals: 18,
            amount: '358558777413486706688',
            priceIn: { price: 0.357, baseCurrency: 'usd' },
            value: 128.00548353661475,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xd533a949740bb3306d119cc777fa900ba034cd52/4a3b2aa9775c79867db769e3bed76e83.png'
          }
        ],
        additionalData: {
          positionInUSD: 57176.510462527964,
          collateralInUSD: 57176.510462527964,
          positionIndex: '1089354',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1089354',
          pool: {
            id: '0x919fa96e88d67499339577fa202345436bcdaf79',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x919fa96e88d67499339577fa202345436bcdaf79',
            index: null,
            time_at: 1620244722
          }
        }
      },
      {
        id: '954ed559-d5fa-4a1f-bc76-cba9f792fd6e',
        assets: [
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '0',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 0,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xd533a949740bb3306d119cc777fa900ba034cd52',
            symbol: 'CRV',
            name: 'Curve DAO Token',
            decimals: 18,
            amount: '267405107081609897574400',
            priceIn: { price: 0.357, baseCurrency: 'usd' },
            value: 95463.62322813473,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xd533a949740bb3306d119cc777fa900ba034cd52/4a3b2aa9775c79867db769e3bed76e83.png'
          }
        ],
        additionalData: {
          positionInUSD: 95463.62322813473,
          collateralInUSD: 95463.62322813473,
          positionIndex: '1043468',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1043468',
          pool: {
            id: '0x919fa96e88d67499339577fa202345436bcdaf79',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x919fa96e88d67499339577fa202345436bcdaf79',
            index: null,
            time_at: 1620244722
          }
        }
      },
      {
        id: '24bd99b3-8061-4b6a-a29f-eb9863fa4506',
        assets: [
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '0',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 0,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72',
            symbol: 'ENS',
            name: 'Ethereum Name Service',
            decimals: 18,
            amount: '5553383504403237961728',
            priceIn: { price: 9.84, baseCurrency: 'usd' },
            value: 54645.29368332786,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc18360217d8f7ab5e7c516566761ea12ce7f9d72/034d454d78d7be7f9675066fdb63e114.png'
          }
        ],
        additionalData: {
          positionInUSD: 54645.29368332786,
          collateralInUSD: 54645.29368332786,
          positionIndex: '1043772',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1043772',
          pool: {
            id: '0x92560c178ce069cc014138ed3c2f5221ba71f58a',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x92560c178ce069cc014138ed3c2f5221ba71f58a',
            index: null,
            time_at: 1636415673
          }
        }
      },
      {
        id: '6164dbde-0e86-4bb2-b0d5-65bf57d38368',
        assets: [
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '0',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 0,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72',
            symbol: 'ENS',
            name: 'Ethereum Name Service',
            decimals: 18,
            amount: '4407360131934216781824',
            priceIn: { price: 9.84, baseCurrency: 'usd' },
            value: 43368.42369823269,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc18360217d8f7ab5e7c516566761ea12ce7f9d72/034d454d78d7be7f9675066fdb63e114.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '41748213772845336',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 121.61212923816072,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72',
            symbol: 'ENS',
            name: 'Ethereum Name Service',
            decimals: 18,
            amount: '11958075231967649792',
            priceIn: { price: 9.84, baseCurrency: 'usd' },
            value: 117.66746028256166,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc18360217d8f7ab5e7c516566761ea12ce7f9d72/034d454d78d7be7f9675066fdb63e114.png'
          }
        ],
        additionalData: {
          positionInUSD: 43607.703287753415,
          collateralInUSD: 43607.703287753415,
          positionIndex: '1062118',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1062118',
          pool: {
            id: '0x92560c178ce069cc014138ed3c2f5221ba71f58a',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x92560c178ce069cc014138ed3c2f5221ba71f58a',
            index: null,
            time_at: 1636415673
          }
        }
      },
      {
        id: '6432025e-1648-416d-84cf-80913368e5d5',
        assets: [
          {
            address: '0x5a98fcbea516cf06857215779fd812ca3bef1b32',
            symbol: 'LDO',
            name: 'Lido DAO Token',
            decimals: 18,
            amount: '130484786197180694134784',
            priceIn: { price: 0.5437674550392362, baseCurrency: 'usd' },
            value: 70953.3801117798,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x5a98fcbea516cf06857215779fd812ca3bef1b32/ca70e712bf4b68bd979e825960a63577.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '365765211816921216',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 1065.4704043705733,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0x5a98fcbea516cf06857215779fd812ca3bef1b32',
            symbol: 'LDO',
            name: 'Lido DAO Token',
            decimals: 18,
            amount: '148984428657956716544',
            priceIn: { price: 0.5437674550392362, baseCurrency: 'usd' },
            value: 81.01288361181177,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x5a98fcbea516cf06857215779fd812ca3bef1b32/ca70e712bf4b68bd979e825960a63577.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '24493674461798304',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 71.34982877047383,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 72171.21322853267,
          collateralInUSD: 72171.21322853267,
          positionIndex: '1068152',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1068152',
          pool: {
            id: '0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74',
            index: null,
            time_at: 1622062029
          }
        }
      },
      {
        id: 'b68bb324-db8a-4236-8eb6-435b5c337074',
        assets: [
          {
            address: '0x514910771af9ca656af840dff83e8264ecf986ca',
            symbol: 'LINK',
            name: 'ChainLink Token',
            decimals: 18,
            amount: '10715096381566383816704',
            priceIn: { price: 12.626380621031242, baseCurrency: 'usd' },
            value: 135292.88530469176,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x514910771af9ca656af840dff83e8264ecf986ca/69425617db0ef93a7c21c4f9b81c7ca5.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '17114579588991655936',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 49854.599196936804,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0x514910771af9ca656af840dff83e8264ecf986ca',
            symbol: 'LINK',
            name: 'ChainLink Token',
            decimals: 18,
            amount: '39481543214037999616',
            priceIn: { price: 12.626380621031242, baseCurrency: 'usd' },
            value: 498.5089921261369,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x514910771af9ca656af840dff83e8264ecf986ca/69425617db0ef93a7c21c4f9b81c7ca5.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '168913470214995488',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 492.0432496015797,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 186138.0367433563,
          collateralInUSD: 186138.0367433563,
          positionIndex: '1059837',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1059837',
          pool: {
            id: '0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8',
            index: null,
            time_at: 1620237038
          }
        }
      },
      {
        id: 'a7bf0d0e-fbb1-4e0f-9d34-2792de728ec1',
        assets: [
          {
            address: '0x514910771af9ca656af840dff83e8264ecf986ca',
            symbol: 'LINK',
            name: 'ChainLink Token',
            decimals: 18,
            amount: '9358640190530627043328',
            priceIn: { price: 12.626380621031242, baseCurrency: 'usd' },
            value: 118165.75314092003,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x514910771af9ca656af840dff83e8264ecf986ca/69425617db0ef93a7c21c4f9b81c7ca5.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '39853495637257150464',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 116092.8342563737,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0x514910771af9ca656af840dff83e8264ecf986ca',
            symbol: 'LINK',
            name: 'ChainLink Token',
            decimals: 18,
            amount: '22866783915091841024',
            priceIn: { price: 12.626380621031242, baseCurrency: 'usd' },
            value: 288.7247172908245,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x514910771af9ca656af840dff83e8264ecf986ca/69425617db0ef93a7c21c4f9b81c7ca5.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '86102672089490720',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 250.81622276996558,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 234798.1283373545,
          collateralInUSD: 234798.1283373545,
          positionIndex: '1121650',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1121650',
          pool: {
            id: '0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8',
            index: null,
            time_at: 1620237038
          }
        }
      },
      {
        id: '29e9c9da-eed9-486a-8c09-95f98c6bae5d',
        assets: [
          {
            address: '0x57e114b691db790c35207b2e685d4a43181e6061',
            symbol: 'ENA',
            name: 'ENA',
            decimals: 18,
            amount: '201239910358197393686528',
            priceIn: { price: 0.2093, baseCurrency: 'usd' },
            value: 42119.51323797072,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x57e114b691db790c35207b2e685d4a43181e6061/f6063e563114a7df3903c930674a9230.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '0',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 0,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0x57e114b691db790c35207b2e685d4a43181e6061',
            symbol: 'ENA',
            name: 'ENA',
            decimals: 18,
            amount: '913237407568835510272',
            priceIn: { price: 0.2093, baseCurrency: 'usd' },
            value: 191.14058940415728,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x57e114b691db790c35207b2e685d4a43181e6061/f6063e563114a7df3903c930674a9230.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '87064617422783840',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 253.61835990639509,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 42564.272187281276,
          collateralInUSD: 42564.272187281276,
          positionIndex: '1091940',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1091940',
          pool: {
            id: '0xc3db44adc1fcdfd5671f555236eae49f4a8eea18',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0xc3db44adc1fcdfd5671f555236eae49f4a8eea18',
            index: null,
            time_at: 1712050067
          }
        }
      },
      {
        id: 'f4c76c93-9be9-48f1-96a6-2ec8b1da9150',
        assets: [
          {
            address: '0x57e114b691db790c35207b2e685d4a43181e6061',
            symbol: 'ENA',
            name: 'ENA',
            decimals: 18,
            amount: '156679237205630962892800',
            priceIn: { price: 0.2093, baseCurrency: 'usd' },
            value: 32792.964347138564,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x57e114b691db790c35207b2e685d4a43181e6061/f6063e563114a7df3903c930674a9230.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '0',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 0,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0x57e114b691db790c35207b2e685d4a43181e6061',
            symbol: 'ENA',
            name: 'ENA',
            decimals: 18,
            amount: '639372238687800918016',
            priceIn: { price: 0.2093, baseCurrency: 'usd' },
            value: 133.82060955735673,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x57e114b691db790c35207b2e685d4a43181e6061/f6063e563114a7df3903c930674a9230.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '53887834290122040',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 156.97472240878258,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 33083.7596791047,
          collateralInUSD: 33083.7596791047,
          positionIndex: '1084948',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1084948',
          pool: {
            id: '0xc3db44adc1fcdfd5671f555236eae49f4a8eea18',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0xc3db44adc1fcdfd5671f555236eae49f4a8eea18',
            index: null,
            time_at: 1712050067
          }
        }
      },
      {
        id: 'ad1acf36-2b49-4c21-9a56-d850d4939e4c',
        assets: [
          {
            address: '0x6dea81c8171d0ba574754ef6f8b412f2ed88c54d',
            symbol: 'LQTY',
            name: 'LQTY',
            decimals: 18,
            amount: '36860766606114573778944',
            priceIn: { price: 0.411, baseCurrency: 'usd' },
            value: 15149.775075113088,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x6dea81c8171d0ba574754ef6f8b412f2ed88c54d/7c7fcc4856098836d29b7bd5814838e8.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '0',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 0,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 15149.775075113088,
          collateralInUSD: 15149.775075113088,
          positionIndex: '1038785',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1038785',
          pool: {
            id: '0xd1d5a4c0ea98971894772dcd6d2f1dc71083c44e',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0xd1d5a4c0ea98971894772dcd6d2f1dc71083c44e',
            index: null,
            time_at: 1620160120
          }
        }
      },
      {
        id: 'c600d3e0-6315-4554-afd9-4d8c610180d0',
        assets: [
          {
            address: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3',
            symbol: 'USDe',
            name: 'USDe',
            decimals: 18,
            amount: '0',
            priceIn: { price: 0.9994620216600697, baseCurrency: 'usd' },
            value: 0,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x4c9edd5852cd905f086c759e8383e09bff1e68b3/1228d6e73f70f37ec1f6fe02a3bbe6ff.png'
          },
          {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            amount: '137396506',
            priceIn: { price: 1.0004001600640255, baseCurrency: 'usd' },
            value: 137.45148745848002,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/fffcd27b9efff5a86ab942084c05924d.png'
          },
          {
            address: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3',
            symbol: 'USDe',
            name: 'USDe',
            decimals: 18,
            amount: '3438569086622975488',
            priceIn: { price: 0.9994620216600697, baseCurrency: 'usd' },
            value: 3.4367192109340188,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x4c9edd5852cd905f086c759e8383e09bff1e68b3/1228d6e73f70f37ec1f6fe02a3bbe6ff.png'
          },
          {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            amount: '3442026',
            priceIn: { price: 1.0004001600640255, baseCurrency: 'usd' },
            value: 3.4434033613445374,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/fffcd27b9efff5a86ab942084c05924d.png'
          }
        ],
        additionalData: {
          positionInUSD: 144.33161003075858,
          collateralInUSD: 144.33161003075858,
          positionIndex: '943596',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '943596',
          pool: {
            id: '0xe6d7ebb9f1a9519dc06d557e03c522d53520e76a',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0xe6d7ebb9f1a9519dc06d557e03c522d53520e76a',
            index: null,
            time_at: 1700745935
          }
        }
      },
      {
        id: '28956ef4-dc94-423b-aa56-dfaebb6709cc',
        assets: [
          {
            address: '0x111111111117dc0aa78b770fa6a738034120c302',
            symbol: '1INCH',
            name: '1INCH Token',
            decimals: 18,
            amount: '15027533635340963151872',
            priceIn: { price: 0.1577, baseCurrency: 'usd' },
            value: 2369.84205429327,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x111111111117dc0aa78b770fa6a738034120c302/2583e21fd1e1b0c9553cc692aa5720e0.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '0',
            priceIn: { price: 2912.99, baseCurrency: 'usd' },
            value: 0,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 2369.84205429327,
          collateralInUSD: 2369.84205429327,
          positionIndex: '1033675',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1765987277,
          position_index: '1033675',
          pool: {
            id: '0xe931b03260b2854e77e8da8378a1bc017b13cb97',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0xe931b03260b2854e77e8da8378a1bc017b13cb97',
            index: null,
            time_at: 1620310693
          }
        }
      }
    ],
    positionInUSD: 2870573.9463264924
  }
]
