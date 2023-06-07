export interface Price {
  baseCurrency: string
  price: number
}

export interface Collectable {
  url: string
  id: bigint
}

export interface TokenResult {
  address: string
  symbol: string
  amount: bigint
  amountPostSimulation?: bigint
  decimals: number
  priceIn: Price[]
  // only applicable for NFTs
  name?: string
  collectables?: Collectable[]
}
