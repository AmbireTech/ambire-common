/* eslint-disable import/no-cycle */
import { Contract, formatUnits, ZeroAddress } from 'ethers'
import { getAddress } from 'viem'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { CustomToken, TokenPreference } from './customToken'
import {
  AccountState,
  ERC721s,
  ExternalHintsAPIResponse,
  FormattedExternalHintsAPIResponse,
  GetOptions,
  Hints,
  NetworkState,
  PortfolioGasTankResult,
  ToBeLearnedAssets,
  TokenResult
} from './interfaces'

const usdcEMapping: { [key: string]: string } = {
  '43114': '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664',
  '1285': '0x748134b5f553f2bcbd78c6826de99a70274bdeb3',
  '42161': '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
  '137': '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  '10': '0x7f5c764cbc14f9669b88837ca1490cca17c31607'
}

export function overrideSymbol(address: string, chainId: bigint, symbol: string) {
  // Since deployless lib calls contract and USDC.e is returned as USDC, we need to override the symbol
  if (
    usdcEMapping[chainId.toString()] &&
    usdcEMapping[chainId.toString()].toLowerCase() === address.toLowerCase()
  ) {
    return 'USDC.E'
  }

  return symbol
}

export function getFlags(
  networkData: any,
  chainId: string,
  tokenChainId: bigint,
  address: string,
  name: string,
  symbol: string
): TokenResult['flags'] {
  const isRewardsOrGasTank = ['gasTank', 'rewards'].includes(chainId)
  const onGasTank = chainId === 'gasTank'

  let rewardsType: TokenResult['flags']['rewardsType'] = null
  if (networkData?.stkWalletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
    rewardsType = 'wallet-rewards'
  if (networkData?.walletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
    rewardsType = 'wallet-vesting'

  const foundFeeToken = gasTankFeeTokens.find(
    (t) =>
      t.address.toLowerCase() === address.toLowerCase() &&
      (isRewardsOrGasTank ? t.chainId === tokenChainId : t.chainId.toString() === chainId)
  )

  const canTopUpGasTank = !!foundFeeToken && !foundFeeToken?.disableGasTankDeposit && !rewardsType
  const isFeeToken =
    address === ZeroAddress ||
    // disable if not in gas tank
    (foundFeeToken && !foundFeeToken.disableAsFeeToken) ||
    chainId === 'gasTank'

  const isKnown = isKnownToken(address, symbol, name)

  return {
    onGasTank,
    rewardsType,
    canTopUpGasTank,
    isFeeToken,
    isHidden: false,
    isKnown
  }
}

export function mergeERC721s(sources: ERC721s[]): ERC721s {
  const result: ERC721s = {}

  // Get all unique addresses
  const addresses = new Set(sources.flatMap((source) => Object.keys(source)))

  addresses.forEach((address) => {
    try {
      const checksummed = getAddress(address)
      // Merge arrays and remove duplicates
      const merged: bigint[] = Array.from(
        new Set(sources.flatMap((source) => source[checksummed] || []))
      )

      result[checksummed] = merged
    } catch (e: any) {
      console.error('Error checksumming ERC-721 collection address', e)
    }
  })

  return result
}

export const mapToken = (
  token: Pick<TokenResult, 'amount' | 'decimals' | 'name' | 'symbol'>,
  network: Network,
  address: string,
  opts: Pick<GetOptions, 'specialErc20Hints'>
) => {
  const { specialErc20Hints } = opts

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
    symbol
  )

  if (specialErc20Hints) {
    if (specialErc20Hints.custom.includes(address)) {
      tokenFlags.isCustom = true
    }
    if (specialErc20Hints.hidden.includes(address)) {
      tokenFlags.isHidden = true
    }
  }

  return {
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
}

export const validateERC20Token = async (
  token: { address: string; chainId: bigint },
  accountId: string,
  provider: RPCProvider
) => {
  const erc20 = new Contract(token?.address, IERC20.abi, provider)

  const type = 'erc20'
  let isValid = true
  let hasError = false

  const [balance, symbol, decimals] = (await Promise.all([
    erc20.balanceOf(accountId).catch(() => {
      hasError = true
    }),
    erc20.symbol().catch(() => {
      hasError = true
    }),
    erc20.decimals().catch(() => {
      hasError = true
    })
  ]).catch(() => {
    hasError = true
    isValid = false
  })) || [undefined, undefined, undefined]

  if (
    typeof balance === 'undefined' ||
    typeof symbol === 'undefined' ||
    typeof decimals === 'undefined'
  ) {
    isValid = false
  }

  isValid = isValid && !hasError
  return [isValid, type]
}

// fetch the amountPostSimulation for the token if set
// otherwise, the token.amount
export const getTokenAmount = (token: TokenResult): bigint => {
  return typeof token.amountPostSimulation === 'bigint' ? token.amountPostSimulation : token.amount
}

export const getTokenBalanceInUSD = (token: TokenResult) => {
  const amount = getTokenAmount(token)
  const { decimals, priceIn } = token
  const balance = parseFloat(formatUnits(amount, decimals))
  const price =
    priceIn.find(({ baseCurrency }: { baseCurrency: string }) => baseCurrency === 'usd')?.price || 0

  return balance * price
}

export const getTotal = (t: TokenResult[], excludeHiddenTokens: boolean = true) =>
  t.reduce((cur: { [key: string]: number }, token: TokenResult) => {
    const localCur = cur // Add index signature to the type of localCur
    if (token.flags.isHidden && excludeHiddenTokens) return localCur
    // eslint-disable-next-line no-restricted-syntax
    for (const x of token.priceIn) {
      const currentAmount = localCur[x.baseCurrency] || 0

      const tokenAmount = Number(getTokenAmount(token)) / 10 ** token.decimals
      localCur[x.baseCurrency] = currentAmount + tokenAmount * x.price
    }

    return localCur
  }, {})

export const addHiddenTokenValueToTotal = (
  totalWithoutHiddenTokens: number,
  tokens: TokenResult[]
) => {
  return tokens.reduce((cur: number, token: TokenResult) => {
    if (!token.flags.isHidden) return cur

    return cur + getTokenBalanceInUSD(token)
  }, totalWithoutHiddenTokens)
}

export const getAccountPortfolioTotal = (
  accountPortfolio: AccountState,
  excludeNetworks: string[] = [],
  excludeHiddenTokens = true
) => {
  if (!accountPortfolio) return 0

  return Object.keys(accountPortfolio).reduce((acc, chainId) => {
    if (excludeNetworks.includes(chainId)) return acc

    const networkData = accountPortfolio[chainId]
    const tokenList = networkData?.result?.tokens || []
    let networkTotalAmountUSD = networkData?.result?.total.usd || 0

    if (!excludeHiddenTokens) {
      networkTotalAmountUSD = addHiddenTokenValueToTotal(networkTotalAmountUSD, tokenList)
    }

    return acc + networkTotalAmountUSD
  }, 0)
}

/**
 * Formats and strips the original velcro response
 */
export const formatExternalHintsAPIResponse = (
  response: ExternalHintsAPIResponse | null
): FormattedExternalHintsAPIResponse | null => {
  if (!response) return null

  const { erc20s, erc721s, lastUpdate, hasHints } = response

  const formattedErc721s: Hints['erc721s'] = {}

  Object.entries(erc721s).forEach(([collectionAddress, value]) => {
    if (!('tokens' in value)) {
      formattedErc721s[collectionAddress] = []
      return
    }

    formattedErc721s[collectionAddress] = value.tokens.map((id) => BigInt(id))
  })

  return {
    erc20s,
    erc721s: formattedErc721s,
    lastUpdate,
    hasHints
  }
}

export const getSpecialHints = (
  chainId: Network['chainId'],
  customTokens: CustomToken[],
  tokenPreferences: TokenPreference[],
  toBeLearnedAssets: ToBeLearnedAssets
) => {
  const specialErc20Hints: GetOptions['specialErc20Hints'] = {
    custom: [],
    hidden: [],
    learn: []
  }
  const specialErc721Hints: GetOptions['specialErc721Hints'] = {
    custom: {},
    hidden: {},
    learn: {}
  }
  const networkToBeLearnedTokens: ToBeLearnedAssets['erc20s'][string] =
    toBeLearnedAssets.erc20s?.[chainId.toString()] || []
  const networkToBeLearnedNfts: ToBeLearnedAssets['erc721s'][string] =
    toBeLearnedAssets.erc721s?.[chainId.toString()] || {}

  customTokens.forEach((token) => {
    if (token.chainId === chainId && token.standard === 'ERC20') {
      specialErc20Hints.custom.push(token.address)
    }
  })

  tokenPreferences.forEach((token) => {
    if (token.chainId === chainId && token.isHidden) {
      specialErc20Hints.hidden.push(token.address)
    }
  })

  if (networkToBeLearnedTokens) {
    networkToBeLearnedTokens.forEach((token) => {
      specialErc20Hints.learn.push(token)
    })
  }

  if (networkToBeLearnedNfts) {
    specialErc721Hints.learn = networkToBeLearnedNfts
  }

  return {
    specialErc20Hints,
    specialErc721Hints
  }
}

/**
 * Converts ERC721 hints to keys that can be used for:
 * - comparison of NFTs
 * - storage
 */
export const erc721CollectionToLearnedAssetKeys = (collection: [string, bigint[]]): string[] => {
  const [collectionAddress, tokenIds] = collection

  if (!tokenIds.length) return [`${collectionAddress}:enumerable`]

  return tokenIds.map((id) => `${collectionAddress}:${id}`)
}

/**
 * Converts `LearnedAssets` ERC721 hint keys to
 * `ERC721` hints. For more info, see `LearnedAssets`
 */
export const learnedErc721sToHints = (keys: string[]): ERC721s => {
  const hints: ERC721s = {}

  keys.forEach((key) => {
    const [collectionAddress, tokenId] = key.split(':')

    if (tokenId === 'enumerable') {
      hints[collectionAddress] = []

      return
    }
    // The key already exists as an enumerable hint. Example:
    // collectionA:enumerable exists and collectionB:id is attempted to be added
    // (it shouldn't be)
    if (keys.includes(`${collectionAddress}:enumerable`)) {
      return
    }

    if (!hints[collectionAddress]) {
      hints[collectionAddress] = []
    }

    hints[collectionAddress].push(BigInt(tokenId))
  })

  return hints
}

export const tokenFilter = (
  token: TokenResult,
  network: Network,
  isToBeLearned: boolean,
  shouldIncludePinned: boolean,
  nativeToken?: TokenResult
): boolean => {
  // Never add ERC20 tokens that represent the network's native token.
  // For instance, on Polygon, we have this token: `0x0000000000000000000000000000000000001010`.
  // It mimics the native POL token (same symbol, same amount) and is shown twice in the Dashboard.
  // From a user's perspective, the token is duplicated and counted twice in the balance.
  const isERC20NativeRepresentation =
    !!nativeToken &&
    (token.symbol === nativeToken.symbol ||
      network.oldNativeAssetSymbols?.includes(token.symbol)) &&
    token.amount === nativeToken.amount &&
    token.address !== ZeroAddress

  if (isERC20NativeRepresentation) return false

  // always include tokens added as a preference
  if (token.flags.isHidden || token.flags.isCustom || isToBeLearned) return true

  // always include > 0 amount and native token
  if (token.amount > 0 || token.address === ZeroAddress) return true

  const isPinned = !!PINNED_TOKENS.find((pinnedToken) => {
    return pinnedToken.chainId === network.chainId && pinnedToken.address === token.address
  })

  // if the amount is 0
  // return the token if it's pinned and requested
  const pinnedRequested = isPinned && !!shouldIncludePinned

  return pinnedRequested
}

export const isPortfolioGasTankResult = (
  result: NetworkState['result']
): result is PortfolioGasTankResult => {
  return !!result && 'gasTankTokens' in result && Array.isArray(result.gasTankTokens)
}

export const isNative = (token: TokenResult) =>
  token.address === ZeroAddress && !token.flags.onGasTank

const nonLatinSymbol = (str: string) => /[^\u0000-\u007f]/.test(str)

const isKnownToken = (
  address: TokenResult['address'],
  symbol: TokenResult['symbol'],
  name: TokenResult['name']
) => {
  return (
    Object.values(humanizerInfo.knownAddresses)
      .map(({ address }) => address.toLowerCase())
      .includes(address.toLowerCase()) ||
    !nonLatinSymbol(symbol) ||
    !nonLatinSymbol(name)
  )
}
