export const dappIdsToBeRemoved = new Set([
  'legends.ambire.com', // Remove legends from the list as it was replaced with rewards.ambire.com
  'yearn.finance', // Remove the legacy Yarn Finance URL from the list
  'getpass.civic.com', // Civic Pass got shut down
  'mean.finance', // Mean Finance became Balmy, but Balmy got shut down
  'polygon.lido.fi', // Lido Polygon staking was sunset on June 16th 2025
  'kwenta.io', // Synthetix acquired Kwenta
  'pro.opensea.io', // Open Sea Pro is no longer on e separate domain
  'app.paraswap.io', // ParaSwap rebranded to Velora
  'snapshot.org', // snapshot.org became snapshot.box
  'play.decentraland.org', // play.decentraland.org redirects to decentraland.org
  'bridge.arbitrum.io', // bridge.arbitrum.io was moved to portal.arbitrum.io
  'curve.fi', // curve.fi was moved to curve.finance
  'app.ether.fi' // app.ether.fi was moved to ether.fi
])

export const featuredDapps = new Set(['rewards.ambire.com', 'bitrefill.com'])

export const predefinedDapps = [
  {
    url: 'https://rewards.ambire.com',
    name: 'Ambire Rewards',
    icon: 'https://rewards.ambire.com/ambire-connect-icon.png',
    description: 'Complete quests, earn XP and climb the leaderboard to secure Ambire rewards.',
    networkNames: ['Ethereum', 'Base', 'Optimism', 'Arbitrum', 'Scroll', 'BNB']
  },
  {
    url: 'https://www.bitrefill.com',
    name: 'Bitrefill',
    icon: 'https://www.bitrefill.com/android-chrome-192x192.png',
    description: 'The crypto store for digital gift cards, eSIMs, and phone refills.',
    networkNames: ['Ethereum', 'Polygon']
  }
]
