import { Interface } from 'ethers'
import ERC20 from '../../../contracts/compiled/IERC20.json'
import { Hex } from '../../interfaces/hex'
import { RPCProvider } from '../../interfaces/provider'

export async function getAllowance(
  tokenAddr: string,
  accAddr: string,
  spender: string,
  provider: RPCProvider
): Promise<Hex> {
  const erc20Interface = new Interface(ERC20.abi)
  const allowance = await provider.call({
    to: tokenAddr,
    data: erc20Interface.encodeFunctionData('allowance', [accAddr, spender])
  })
  return allowance as Hex
}
