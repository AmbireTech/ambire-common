import { Network } from '../../interfaces/network'
import { GetOptions, SuspectedType, TokenResult } from './interfaces'
import { getFeeToken, overrideSymbol, ZERO_ADDRESS } from './tokenIndexes'
import { isSuspectedToken } from './tokenSuspicion'

// Re-exported so the public surface stays where callers already import it from
export { isSuspectedToken } from './tokenSuspicion'

// Reduced network shape: only the fields mapToken actually reads. Network
// satisfies it structurally so no caller has to change, and offloaded callers
// ship a smaller payload across the thread boundary.
export type MapTokenNetwork = Pick<
  Network,
  'chainId' | 'name' | 'nativeAssetName' | 'nativeAssetSymbol'
>

// Network and the hint lists below are owned by controllers that keep mutating
// them. Handing one straight to an offloaded task marks it as serialized, and
// the next write to it warns and may not be seen on the other side, so both are
// copied into fresh objects first. See src/libs/offload/README.md.

/** Copies the network fields mapToken reads into a fresh object. */
export const toMapTokenNetwork = (network: MapTokenNetwork): MapTokenNetwork => ({
  chainId: network.chainId,
  name: network.name,
  nativeAssetName: network.nativeAssetName,
  nativeAssetSymbol: network.nativeAssetSymbol
})

/** Copies the special ERC20 hint lists into fresh arrays. */
export const toMapTokenHints = (
  hints: GetOptions['specialErc20Hints']
): GetOptions['specialErc20Hints'] =>
  hints && {
    custom: [...hints.custom],
    hidden: [...hints.hidden],
    learn: [...hints.learn]
  }

export function getFlags(
  networkData: any,
  chainId: string,
  tokenChainId: bigint,
  address: string,
  name: string,
  symbol: string,
  hasSimulationAmount?: boolean
): TokenResult['flags'] {
  const isRewardsOrGasTank = ['gasTank', 'rewards'].includes(chainId)
  const onGasTank = chainId === 'gasTank'

  let rewardsType: TokenResult['flags']['rewardsType'] = null
  if (networkData?.stkWalletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
    rewardsType = 'wallet-rewards'
  if (networkData?.walletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
    rewardsType = 'wallet-vesting'

  const foundFeeToken = getFeeToken(address, chainId, tokenChainId)

  const canTopUpGasTank = !!foundFeeToken && !foundFeeToken?.disableGasTankDeposit && !rewardsType
  const isFeeToken =
    address === ZERO_ADDRESS ||
    // disable if not in gas tank
    (foundFeeToken && !foundFeeToken.disableAsFeeToken) ||
    chainId === 'gasTank'

  let suspectedType: SuspectedType = null

  // The scan walks every known address with a per-entry NFC normalize, so it is
  // deliberately limited to tokens the simulation actually moved — a handful per
  // simulation, and none at all on the dashboard path.
  if (hasSimulationAmount && !isRewardsOrGasTank) {
    suspectedType = isSuspectedToken(address, symbol, BigInt(chainId))
  }

  return {
    onGasTank,
    rewardsType,
    canTopUpGasTank,
    isFeeToken,
    isHidden: false,
    suspectedType
  }
}

export const mapToken = (
  token: Pick<TokenResult, 'amount' | 'decimals' | 'name' | 'symbol'>,
  network: MapTokenNetwork,
  address: string,
  opts: Pick<GetOptions, 'specialErc20Hints' | 'blockTag'>,
  hasSimulationAmount?: boolean,
  latestAmount?: bigint
) => {
  const { specialErc20Hints, blockTag } = opts

  let symbol = 'Unknown'
  try {
    symbol = overrideSymbol(address, network.chainId, token.symbol)
  } catch (e: any) {
    console.log(`no symbol was found for token with address ${address} on ${network.name}`)
  }

  let tokenName = symbol
  try {
    tokenName = token.name
  } catch (e: any) {
    console.log(
      `no name was found for a token with a symbol of: ${symbol}, address: ${address} on ${network.name}`
    )
  }

  const tokenFlags: TokenResult['flags'] = getFlags(
    {},
    network.chainId.toString(),
    network.chainId,
    address,
    tokenName,
    symbol,
    hasSimulationAmount
  )

  if (specialErc20Hints) {
    if (specialErc20Hints.custom.includes(address)) {
      tokenFlags.isCustom = true
    }
    if (specialErc20Hints.hidden.includes(address)) {
      tokenFlags.isHidden = true
    }
  }

  const tokenResult = {
    amount: token.amount,
    chainId: network.chainId,
    decimals: Number(token.decimals),
    name:
      address === '0x0000000000000000000000000000000000000000'
        ? network.nativeAssetName
        : tokenName,
    symbol:
      address === '0x0000000000000000000000000000000000000000' ? network.nativeAssetSymbol : symbol,
    address,
    flags: tokenFlags
  } as TokenResult

  if (blockTag !== 'both') return tokenResult

  return {
    ...tokenResult,
    // Fallback to the pending amount if latestAmount is not provided
    // Otherwise it will look like someone is receiving tokens and the current amount is 0
    // It's important that we are using ?? here instead of ||
    // because latestAmount can be 0
    latestAmount: latestAmount ?? token.amount,
    pendingAmount: tokenResult.amount
  }
}
