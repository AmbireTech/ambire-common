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
    link: 'https://blog.ambire.com/announcing-the-wallet-token-a137aeda9747',
    icon_svg: 'rewards-beta-tester'
  },
  {
    id: 'lobsters',
    name: 'Lobsters',
    icon: '🦞',
    color: '#E82949',
    multiplier: 1.5,
    link: 'https://blog.ambire.com/ambire-wallet-to-partner-with-lobsterdao-10b57e6da0-53c59c88726b',
    icon_svg: 'rewards-lobster'
  },
  {
    id: 'cryptoTesters',
    name: 'CryptoTesters',
    icon: '🧑‍🔬',
    color: '#b200e1',
    multiplier: 1.25,
    link: 'https://blog.ambire.com/win-a-cryptotesters-nft-with-ambire-and-get-into-one-of-the-hottest-web3-communities-c9d7185760b1',
    icon_svg: 'rewards-crypto-tester'
  },
  {
    id: 'gasTankNft',
    name: 'GasTankNFT',
    icon: '⛽',
    color: '#b18045',
    multiplier: 1.25,
    link: 'https://blog.ambire.com/ambire-gas-tank-launches-with-exclusive-nft-drop-2a4eb29f2f07',
    icon_svg: 'rewards-gas-tank'
  },
  {
    id: 'powerUserMultiplier',
    name: 'Power User',
    icon: '💸',
    color: '#658f3f',
    multiplier: 1.25,
    link: 'https://blog.ambire.com/new-wallet-rewards-multiplier-live-in-ambire-power-users-now-get-special-perks-e47bb1000aeb',
    icon_svg: 'reward-power-user'
  },
  /*{
    id: 'adxStakingApy',
    name: 'ADX staking rewards',
    icon: 'ADX',
    color: '#28879c',
    multiplier: 0,
    link: 'https://blog.ambire.com/wallet-rewards-mechanism-explained-start-accumulating-value-before-the-token-is-launched-5e9ee36cefdd'
  },*/
]

export const MULTIPLIERS_READ_MORE_URL =
  'https://blog.ambire.com/announcing-the-wallet-token-a137aeda9747'
