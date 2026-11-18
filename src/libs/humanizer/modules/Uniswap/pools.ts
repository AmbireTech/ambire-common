import { Hex, encodePacked, getCreate2Address, keccak256 } from 'viem'

/**
 * Some swaps are made of many commands. The first one sends its tokens to the pool of the next one,
 * and the next one swaps what the pool already holds. This is the only case where the address of a
 * pool is a recipient that is not shown.
 *
 * An address is a pool of a swap only when it is the address that its factory gives to the pool of
 * the two tokens of that swap. An address that is only said to be a pool is not trusted.
 */

type UniswapV2Factory = { factory: string; initCodeHash: Hex }

const UNISWAP_V2_INIT_CODE_HASH: Hex =
  '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f'

const UNISWAP_V2_FACTORIES: { [chainId: string]: UniswapV2Factory } = {
  // Ethereum
  '1': {
    factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    initCodeHash: UNISWAP_V2_INIT_CODE_HASH
  },
  // Base
  '8453': {
    factory: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
    initCodeHash: UNISWAP_V2_INIT_CODE_HASH
  }
}

// Aerodrome (Base) deploys each pool as a minimal proxy of one implementation
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da'
const AERODROME_POOL_IMPLEMENTATION = 'a4e46b4f701c62e14df11b48dce76a7d793cd6d7'
const AERODROME_CHAIN_ID = '8453'

const sortTokens = (tokenA: string, tokenB: string): [string, string] =>
  tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA]

/** The pool of the two tokens in Uniswap V2, or `undefined` when the network is not known */
export const getUniswapV2Pool = (
  chainId: bigint,
  tokenA: string,
  tokenB: string
): string | undefined => {
  const deployment = UNISWAP_V2_FACTORIES[chainId.toString()]
  if (!deployment) return undefined

  const [token0, token1] = sortTokens(tokenA, tokenB)
  return getCreate2Address({
    from: deployment.factory as Hex,
    salt: keccak256(encodePacked(['address', 'address'], [token0 as Hex, token1 as Hex])),
    bytecodeHash: deployment.initCodeHash
  }).toLowerCase()
}

/** The pool of the two tokens in Aerodrome, or `undefined` when the network is not Base */
export const getAerodromePool = (
  chainId: bigint,
  tokenA: string,
  tokenB: string,
  isStable: boolean
): string | undefined => {
  if (chainId.toString() !== AERODROME_CHAIN_ID) return undefined

  const [token0, token1] = sortTokens(tokenA, tokenB)
  const initCode: Hex = `0x3d602d80600a3d3981f3363d3d373d3d3d363d73${AERODROME_POOL_IMPLEMENTATION}5af43d82803e903d91602b57fd5bf3`
  return getCreate2Address({
    from: AERODROME_FACTORY,
    salt: keccak256(
      encodePacked(['address', 'address', 'bool'], [token0 as Hex, token1 as Hex, isStable])
    ),
    bytecodeHash: keccak256(initCode)
  }).toLowerCase()
}
