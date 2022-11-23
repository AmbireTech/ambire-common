export type MultiplierBadge = {
  id: string
  name: string
  icon: string
  color: string
  multiplier: number
  link: string
}

export const multiplierBadges: MultiplierBadge[] = [
  {
    id: 'beta-tester',
    name: 'Beta Testers',
    icon: '🧪',
    color: '#6000FF',
    multiplier: 1.25,
    link: 'https://blog.ambire.com/announcing-the-wallet-token-a137aeda9747'
  },
  {
    id: 'lobsters',
    name: 'Lobsters',
    icon: '🦞',
    color: '#E82949',
    multiplier: 1.5,
    link: 'https://blog.ambire.com/ambire-wallet-to-partner-with-lobsterdao-10b57e6da0-53c59c88726b'
  },
  {
    id: 'cryptoTesters',
    name: 'CryptoTesters',
    icon: '🧑‍🔬',
    color: '#b200e1',
    multiplier: 1.25,
    link: 'https://blog.ambire.com/win-a-cryptotesters-nft-with-ambire-and-get-into-one-of-the-hottest-web3-communities-c9d7185760b1'
  },
  /*
  because the promotion is ended we will hide this and when we start a promotion again will will show it.
  {
    id: 'gasTankNft',
    name: 'GasTankNFT',
    icon: '⛽',
    color: '#b18045',
    multiplier: 1.25,
    link: 'https://blog.ambire.com/ambire-gas-tank-launches-with-exclusive-nft-drop-2a4eb29f2f07'
  },*/
  {
    id: 'powerUserMultiplier',
    name: 'Power User',
    icon: '💸',
    color: '#658f3f',
    multiplier: 1.25,
    link: 'https://blog.ambire.com/new-wallet-rewards-multiplier-live-in-ambire-power-users-now-get-special-perks-e47bb1000aeb'
  },
  /*
  Originally planned to display the ADX bonus badge.
  No icon / badge asset for ADX at the moment.
  ADX Data is used in the table below in web app for now.
  {
    id: 'adxStakingApy',
    name: 'ADX staking rewards',
    icon: 'ADX',
    color: '#28879c',
    multiplier: 0,
    link: 'https://blog.ambire.com/new-wallet-rewards-multiplier-live-in-ambire-power-users-now-get-special-perks-e47bb1000aeb'
  },*/
]

export const MULTIPLIERS_READ_MORE_URL =
  'https://blog.ambire.com/announcing-the-wallet-token-a137aeda9747'
