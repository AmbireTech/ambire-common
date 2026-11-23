/**
 * Morpho contracts by chain id. Addresses are from Morpho's address book
 * (`@morpho-org/blue-sdk`), verified on-chain.
 */
export const MORPHO: {
  [chainId: string]: {
    morphoAddr: string
    /** MetaMorpho (vault v1) factories, the legacy v1.0 one included where it was deployed */
    metaMorphoFactoryAddrs: string[]
    vaultV2FactoryAddrs: string[]
  }
} = {
  // Ethereum
  '1': {
    morphoAddr: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
    metaMorphoFactoryAddrs: [
      '0x1897A8997241C1cD4bD0698647e4EB7213535c24',
      '0xA9c3D3a366466Fa809d1Ae982Fb2c46E5fC41101'
    ],
    vaultV2FactoryAddrs: ['0xA1D94F746dEfa1928926b84fB2596c06926C0405']
  },
  // Base
  '8453': {
    morphoAddr: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
    metaMorphoFactoryAddrs: [
      '0xFf62A7c278C62eD665133147129245053Bbf5918',
      '0xA9c3D3a366466Fa809d1Ae982Fb2c46E5fC41101'
    ],
    vaultV2FactoryAddrs: ['0x4501125508079A99ebBebCE205DeC9593C2b5857']
  },
  // Arbitrum
  '42161': {
    morphoAddr: '0x6c247b1F6182318877311737BaC0844bAa518F5e',
    metaMorphoFactoryAddrs: ['0x878988f5f561081deEa117717052164ea1Ef0c82'],
    vaultV2FactoryAddrs: ['0x6b46fa3cc9EBF8aB230aBAc664E37F2966Bf7971']
  },
  // Optimism
  '10': {
    morphoAddr: '0xce95AfbB8EA029495c66020883F87aaE8864AF92',
    metaMorphoFactoryAddrs: ['0x3Bb6A6A0Bc85b367EFE0A5bAc81c5E52C892839a'],
    vaultV2FactoryAddrs: ['0x6128b680b277Bf4Df80DFE9D8c55A498660870ef']
  },
  // Polygon
  '137': {
    morphoAddr: '0x1bF0c2541F820E775182832f06c0B7Fc27A25f67',
    metaMorphoFactoryAddrs: ['0xa9c87daB340631C34BB738625C70499e29ddDC98'],
    vaultV2FactoryAddrs: ['0xC11a53eE9B1eCc7a068D8e40F8F17926584F97Cf']
  }
}
