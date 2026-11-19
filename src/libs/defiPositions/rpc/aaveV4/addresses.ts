/** A lending market of Aave v4, with its own collateral, debt and health factor */
export type AaveV4Spoke = {
  address: string
  /** Shown to the user as `<name> market` */
  name: string
}

/**
 * The spokes of the Aave v4 instances that Aave runs, by chain id. Taken from the Aave address
 * book (https://github.com/bgd-labs/aave-address-book, `src/ts/AaveV4<Network>.ts`), without
 * the treasury spokes, which hold the fees of the protocol. Spokes added after the last update
 * of this list are not read.
 */
export const AAVE_V4_SPOKES: { [chainId: string]: AaveV4Spoke[] } = {
  // Ethereum
  '1': [
    { address: '0x94e7A5dCbE816e498b89aB752661904E2F56c485', name: 'Main' },
    { address: '0x973a023A77420ba610f06b3858aD991Df6d85A08', name: 'Bluechip' },
    { address: '0x58131E79531caB1d52301228d1f7b842F26B9649', name: 'Ethena Correlated' },
    { address: '0xba1B3D55D249692b669A164024A838309B7508AF', name: 'Ethena Ecosystem' },
    { address: '0xD8B93635b8C6d0fF98CbE90b5988E3F2d1Cd9da1', name: 'Forex' },
    { address: '0x65407b940966954b23dfA3caA5C0702bB42984DC', name: 'Gold' },
    { address: '0x7EC68b5695e803e98a21a9A05d744F28b0a7753D', name: 'Lombard BTC' },
    { address: '0xAD75cE6354f87F3135cE10621d385d8D1e2562C2', name: 'PAXG Gold' },
    { address: '0x956d8e0A89cfa3744428C4641b5a53B56167a7f9', name: 'USDG Pendle' },
    { address: '0xbF10BDfE177dE0336aFD7fcCF80A904E15386219', name: 'EtherFi' },
    { address: '0x3131FE68C4722e726fe6B2819ED68e514395B9a4', name: 'Kelp' },
    { address: '0xe1900480ac69f0B296841Cd01cC37546d92F35Cd', name: 'Lido' },
    { address: '0x115aF1C2db26cD8ECa3f29055E4E424AF4edF616', name: 'PAXG Paxos' },
    { address: '0x774b9655413c34809c1f1b16b654465A89EBE989', name: 'USDG Maple' }
  ],
  // Avalanche
  '43114': [
    { address: '0x435272CefF93a1E657E8ABfdf0A13e95900A3a56', name: 'Main' },
    { address: '0x6a37776B5E026dBdF043b4F933c323C84DD1B514', name: 'Forex' },
    { address: '0x3b517594277c67307CF2d7CBE6FE1D4399B68c41', name: 'AVAX Correlated' },
    { address: '0xaf22446124e566e54845f65b722E4dCbf12b650A', name: 'Ethena Ecosystem' }
  ],
  // Base
  '8453': [{ address: '0x17905Db0e4A3514467539956c084180616AE7B8D', name: 'MAG7' }],
  // Arc
  '5042': [
    { address: '0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d', name: 'Main' },
    { address: '0x4164EBCAF74670aa74C8D4F59de6157c0780F1bB', name: 'Forex' },
    { address: '0x18Dde098d25722C14e09842a6Fa7db6aAFC395a2', name: 'USDC Maple' }
  ]
}
