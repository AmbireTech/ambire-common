type ACTION_GAS_COST = {
  name: string
  gas: number
}

export const ACTION_GAS_COSTS: ACTION_GAS_COST[] = [
  { name: 'Ambire: Claim and burn', gas: 163327 },
  { name: 'Ambire: Claim and stake', gas: 213230 },
  { name: 'SushiSwap: Swap', gas: 140972 },
  { name: 'Opensea: Sale', gas: 201953 },
  { name: 'Uniswap V3: Swap', gas: 184206 },
  { name: 'USDT: Transfer', gas: 54000 },
  { name: 'Curve: Swap', gas: 749187 },
  { name: 'Balancer: Swap', gas: 196234 },
  { name: 'Bancor: Swap', gas: 182860 },
  { name: '1inch: Swap', gas: 141645 },
  { name: 'KyberSwap: Swap', gas: 144084 },
  { name: 'ERC20: Transfer', gas: 64850 },
  { name: 'Uniswap V2: Swap', gas: 152495 },
  { name: 'ERC721: Transfer', gas: 84785 },
  { name: 'CoW Protocol: Swap', gas: 342673 },
  { name: 'SuperRare: Sale', gas: 130458 },
  { name: 'Rarible: Sale', gas: 245271 },
  { name: 'LooksRare: Sale', gas: 326271 },
  { name: 'SuperRare: Offer', gas: 85037 },
  { name: 'Uniswap V3: Add Liquidity', gas: 216505 },
  { name: 'Curve: Add Liquidity', gas: 902944 },
  { name: 'ENS: Register Domain', gas: 266467 },
  { name: 'Gnosis Safe: Create Multisig', gas: 287748 },
  { name: 'Arbitrum: Deposit', gas: 90925 },
  { name: 'Optimism: Deposit', gas: 150561 },
  { name: 'Polygon: Deposit', gas: 148963 },
  { name: 'Ronin: Deposit', gas: 163430 },
  { name: 'zkSync: Deposit', gas: 143159 },
  { name: 'Beacon Chain: Deposit', gas: 52822 },
  { name: 'Ribbon Finance: Deposit', gas: 92860 },
  { name: 'Ribbon Finance: Withdraw', gas: 98748 },
  { name: 'dYdX: Borrow', gas: 173944 },
  { name: 'MakerDAO: Borrow', gas: 232907 },
  { name: 'Compound: Collect', gas: 1237037 },
  { name: 'Compound: Borrow', gas: 339561 },
  { name: 'Compound: Repay', gas: 112121 },
  { name: 'KyberSwap: Stake', gas: 214402 },
  { name: 'Tornado.Cash: Deposit', gas: 1012121 },
  { name: 'Tornado.Cash: Withdraw', gas: 360168 },
  { name: '0x: Swap', gas: 326607 },
  { name: 'Aave: Borrow', gas: 318196 },
  { name: 'Aave: Repay', gas: 199430 },
  { name: 'Convex Finance: Stake', gas: 513841 },
  { name: 'Lido: Stake', gas: 82514 },
  { name: 'Yearn Finance: Deposit', gas: 215916 },
  { name: 'Hop Protocol: Bridge', gas: 121374 },
  { name: 'Multichain: Bridge', gas: 57785 },
  { name: 'Across Protocol: Bridge', gas: 120701 },
  { name: 'Synapse: Bridge', gas: 107664 },
  { name: 'Lido: Stake', gas: 87477 }
]

export const AMBIRE_OVERHEAD_COST: number = 5000
