type Badge = {
  id: string
  name: string
  icon: string
  color: string
  multiplier: number
  link: string
}

export const multiplierBadges: Badge[] = [
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
  }
]
