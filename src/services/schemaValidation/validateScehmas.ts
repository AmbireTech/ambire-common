/* eslint-disable global-require */
import Ajv from 'ajv'

const ajv = new Ajv()

export const schemas: any = {
  EmailVaultData: ajv.compile(require('./schemas/EmailVaultData.json')),
  RecoveryKey: ajv.compile(require('./schemas/RecoveryKey.json')),
  EmailVaultSecrets: ajv.compile(require('./schemas/EmailVaultSecrets.json')),
  RelayerResponseLinkedAccount: ajv.compile(require('./schemas/RelayerResponseLinkedAccount.json')),
  RelayerReponsePortfolioAdditional: ajv.compile(
    require('./schemas/RelayerReponsePortfolioAdditional.json')
  )
}

const res = schemas.RelayerReponsePortfolioAdditional({
  rewards: {
    supplyControllerAddr: '0x6FDb43bca2D8fe6284242d92620156205d4fA028',
    claimableRewardsData: {
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      fromBalanceClaimable: 15440.518314726178,
      fromADXClaimable: 0,
      totalClaimable: '15440518314726177000000',
      leaf: '0x011b66632a19f6dddf9d43ce0e016821583d9f5b96abd0c718b1570899e7f1e1',
      proof: [
        '0x004a6eba408344de18cdda907655c683bedbf23c17339527756c2f6629114aef',
        '0xa0b21d690caca375636191dc60525697e181f1ad4eb7e82152223459f2ca17d6'
      ],
      root: '0x2f4530e886ceadb4e649e761cf1257fb7292d7ab8ff6fcce2bae8a1e9c698732',
      signedRoot:
        '0xe2c2196108f8b19ff82ed78acf723830c6d8a7298120041e6f146fe6453d2f2f5edc8f14a1a2f8fac9b19f82f46e27e1235756f47b61e6e0871d46e864a2231e1c01'
    },
    multipliers: [],
    xWalletClaimableBalance: {
      address: '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935',
      symbol: 'XWALLET',
      amount: '877000000000000000000',
      decimals: 18,
      networkId: 'ethereum',
      priceIn: [
        {
          baseCurrency: 'usd',
          price: 0.12655558000831507
        }
      ]
    }
  },
  gasTank: {
    balance: [
      {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        amount: '98871349',
        decimals: 6,
        networkId: 'ethereum',
        priceIn: [
          {
            baseCurrency: 'usd',
            price: 0.999603
          }
        ]
      }
    ],
    availableGasTankAssets: [
      {
        address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
        symbol: 'dai',
        network: 'base',
        decimals: 18,
        icon: 'https://assets.coingecko.com/coins/images/9956/small/4943.png',
        price: 0.999169
      }
    ]
  }
})

console.log(res)
console.log(schemas.RelayerReponsePortfolioAdditional.errors)
