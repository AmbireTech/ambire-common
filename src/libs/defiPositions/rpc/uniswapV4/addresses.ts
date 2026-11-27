/**
 * The contracts of Uniswap v4 that the positions are read from, by chain id. Taken from
 * https://docs.uniswap.org/contracts/v4/deployments
 */
export const UNISWAP_V4: {
  [chainId: string]: {
    /** The NFT of the positions */
    positionManagerAddr: string
    /** Reads the current price of a pool */
    stateViewAddr: string
  }
} = {
  // Ethereum
  '1': {
    positionManagerAddr: '0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e',
    stateViewAddr: '0x7ffe42c4a5deea5b0fec41c94c136cf115597227'
  },
  // Unichain
  '130': {
    positionManagerAddr: '0x4529a01c7a0410167c5740c487a8de60232617bf',
    stateViewAddr: '0x86e8631a016f9068c3f085faf484ee3f5fdee8f2'
  },
  // Optimism
  '10': {
    positionManagerAddr: '0x3c3ea4b57a46241e54610e5f022e5c45859a1017',
    stateViewAddr: '0xc18a3169788f4f75a170290584eca6395c75ecdb'
  },
  // Base
  '8453': {
    positionManagerAddr: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
    stateViewAddr: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71'
  },
  // Arbitrum One
  '42161': {
    positionManagerAddr: '0xd88f38f930b7952f2db2432cb002e7abbf3dd869',
    stateViewAddr: '0x76fd297e2d437cd7f76d50f01afe6160f86e9990'
  },
  // Polygon
  '137': {
    positionManagerAddr: '0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9',
    stateViewAddr: '0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a'
  },
  // World Chain
  '480': {
    positionManagerAddr: '0xc585e0f504613b5fbf874f21af14c65260fb41fa',
    stateViewAddr: '0x51d394718bc09297262e368c1a481217fdeb71eb'
  },
  // Ink
  '57073': {
    positionManagerAddr: '0x1b35d13a2e2528f192637f14b05f0dc0e7deb566',
    stateViewAddr: '0x76fd297e2d437cd7f76d50f01afe6160f86e9990'
  },
  // Soneium
  '1868': {
    positionManagerAddr: '0x1b35d13a2e2528f192637f14b05f0dc0e7deb566',
    stateViewAddr: '0x76fd297e2d437cd7f76d50f01afe6160f86e9990'
  },
  // Avalanche
  '43114': {
    positionManagerAddr: '0xb74b1f14d2754acfcbbe1a221023a5cf50ab8acd',
    stateViewAddr: '0xc3c9e198c735a4b97e3e683f391ccbdd60b69286'
  },
  // BNB Smart Chain
  '56': {
    positionManagerAddr: '0x7a4a5c919ae2541aed11041a1aeee68f1287f95b',
    stateViewAddr: '0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4'
  },
  // Celo
  '42220': {
    positionManagerAddr: '0xf7965f3981e4d5bc383bfbcb61501763e9068ca9',
    stateViewAddr: '0xbc21f8720babf4b20d195ee5c6e99c52b76f2bfb'
  },
  // Monad
  '143': {
    positionManagerAddr: '0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016',
    stateViewAddr: '0x77395f3b2e73ae90843717371294fa97cc419d64'
  },
  // MegaETH
  '4326': {
    positionManagerAddr: '0x9ae0921e981aaa7308f176f8d4f9129b9247c89d',
    stateViewAddr: '0x726f84e1dfb8d375a365e0808282f40d52d3e4e8'
  },
  // Robinhood Chain
  '4663': {
    positionManagerAddr: '0x58daec3116aae6d93017baaea7749052e8a04fa7',
    stateViewAddr: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b'
  },
  // Arc
  '5042': {
    positionManagerAddr: '0x6049c9a0e26405c0985f9e3685c87d0ae917f82b',
    stateViewAddr: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b'
  },
  // HyperEVM
  '999': {
    positionManagerAddr: '0x0d7ab5b3db668128aff6f70c4ebc71d7d4da9bf9',
    stateViewAddr: '0x1656326235cb9e34cb58cade53ae30789ab32a1a'
  }
}
