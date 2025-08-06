import { Contract, formatUnits, ZeroAddress } from 'ethers'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { CustomToken, TokenPreference } from './customToken'
import {
  AccountState,
  AdditionalPortfolioNetworkResult,
  GetOptions,
  NetworkState,
  PortfolioGasTankResult,
  PreviousHintsStorage,
  StrippedExternalHintsAPIResponse,
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
  address: string
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

  return {
    onGasTank,
    rewardsType,
    canTopUpGasTank,
    isFeeToken,
    isHidden: false
  }
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

export const stripExternalHintsAPIResponse = (
  response: StrippedExternalHintsAPIResponse | null
): StrippedExternalHintsAPIResponse | null => {
  if (!response) return null

  const { erc20s, erc721s, lastUpdate, skipOverrideSavedHints } = response

  return {
    erc20s,
    erc721s,
    lastUpdate,
    skipOverrideSavedHints: !!skipOverrideSavedHints
  }
}

const getLowercaseAddressArrayForNetwork = (
  array: { address: string; chainId?: bigint }[],
  chainId: bigint
) =>
  array
    .filter((item) => !chainId || item.chainId === chainId)
    .map((item) => item.address.toLowerCase())

/**
 * Tasks:
 * - updates the external hints for [network:account] with the latest from the external API
 * - cleans the learned tokens by removing non-ERC20 items
 * - updates the timestamp of learned tokens
 * - returns the updated hints
 */
export function getUpdatedHints(
  // Can only be null in case of no external api hints
  latestHintsFromExternalAPI: StrippedExternalHintsAPIResponse | null,
  tokens: TokenResult[],
  tokenErrors: AdditionalPortfolioNetworkResult['tokenErrors'],
  chainId: bigint,
  storagePreviousHints: PreviousHintsStorage,
  key: string,
  customTokens: CustomToken[],
  tokenPreferences: TokenPreference[]
): PreviousHintsStorage {
  const previousHints = { ...storagePreviousHints }

  if (!previousHints.fromExternalAPI) previousHints.fromExternalAPI = {}
  if (!previousHints.learnedTokens) previousHints.learnedTokens = {}

  const { learnedTokens, learnedNfts } = previousHints
  const latestERC20HintsFromExternalAPI = latestHintsFromExternalAPI?.erc20s || []
  const networkLearnedTokens = learnedTokens[chainId.toString()] || {}

  // The keys in learnedTokens are addresses of tokens
  const networkLearnedTokenAddresses = Object.keys(networkLearnedTokens)

  // Self-cleaning mechanism for removing non-ERC20 items from the learned tokens.
  // There's a possibility that the discovered tokens (from debug_traceCall or mostly Humanizer) include items that are not ERC20 tokens.
  // For instance, a SmartContract address can be passed as a learned token.
  // Thanks to BalanceGetter, we know which tokens encounter an error when we try to update the portfolio.
  // All the errors are collected in `tokenErrors`, and if we cannot retrieve its balance,
  // the contract returns `bytes('unkn')`, which is equal to `0x756e6b6e`.
  // Note:
  // When we extract tokens from `debug_traceCall`, we are already filtering the tokens the same way as here (relying on BalanceGetter).
  // However, for the Humanizer tokens, we skipped that check because the Humanizer is invoked more frequently on the Sign screen,
  // and this validation may slow down the performance of the page. Because of this, we perform the check here, where we are calling BalanceGetter anyway.
  const unknownBalanceError = '0x756e6b6e'
  const networkLearnedTokenAddressesHavingError = networkLearnedTokenAddresses.filter(
    (tokenAddress) => {
      const hasError = !!tokenErrors?.find(
        (errorToken) =>
          errorToken.address.toLowerCase() === tokenAddress.toLowerCase() &&
          errorToken.error === unknownBalanceError
      )

      return hasError
    }
  )

  if (networkLearnedTokenAddresses.length) {
    // Lowercase all addresses outside of the loop for better performance
    const lowercaseNetworkPinnedTokenAddresses = getLowercaseAddressArrayForNetwork(
      PINNED_TOKENS,
      chainId
    )
    const lowercaseCustomTokens = getLowercaseAddressArrayForNetwork(customTokens, chainId)
    const lowercaseTokenPreferences = getLowercaseAddressArrayForNetwork(tokenPreferences, chainId)
    const networkTokensWithBalance = tokens.filter((token) => token.amount > 0n)
    const lowercaseNetworkTokenAddressesWithBalance = getLowercaseAddressArrayForNetwork(
      networkTokensWithBalance,
      chainId
    )
    const lowercaseERC20HintsFromExternalAPI = latestERC20HintsFromExternalAPI.map((hint) =>
      hint.toLowerCase()
    )

    // Update the timestamp of learned tokens
    // and self-clean non-ERC20 items.
    // eslint-disable-next-line no-restricted-syntax
    for (const address of networkLearnedTokenAddresses) {
      const lowercaseAddress = address.toLowerCase()

      // Delete non-ERC20 items from the learned tokens
      if (
        networkLearnedTokenAddressesHavingError.find(
          (errorToken) => errorToken.toLowerCase() === lowercaseAddress
        )
      ) {
        delete learnedTokens[chainId.toString()][lowercaseAddress]
        // eslint-disable-next-line no-continue
        continue
      }

      const isPinned = lowercaseNetworkPinnedTokenAddresses.includes(lowercaseAddress)
      const isCustomToken = lowercaseCustomTokens.includes(lowercaseAddress)
      const isTokenPreference = lowercaseTokenPreferences.includes(lowercaseAddress)
      const isTokenInExternalAPIHints =
        lowercaseERC20HintsFromExternalAPI.includes(lowercaseAddress)
      const hasBalance = lowercaseNetworkTokenAddressesWithBalance.includes(lowercaseAddress)

      if (
        !isTokenInExternalAPIHints &&
        !isPinned &&
        !isCustomToken &&
        !isTokenPreference &&
        hasBalance
      ) {
        // Don't set the timestamp back to null if the account doesn't have balance for the token
        // as learnedTokens aren't account specific and one account can have balance for the token
        // while other don't
        learnedTokens[chainId.toString()][address] = Date.now().toString()
      }
    }
  }
  // Update the external hints for [network:account] with the latest from the external API
  previousHints.fromExternalAPI[key] = latestHintsFromExternalAPI

  return {
    fromExternalAPI: previousHints.fromExternalAPI,
    learnedTokens,
    learnedNfts
  }
}

export const getSpecialHints = (
  chainId: Network['chainId'],
  customTokens: CustomToken[],
  tokenPreferences: TokenPreference[],
  toBeLearnedTokens: {
    [chainId: string]: string[]
  }
) => {
  // The order is important here.
  // Learned tokens are first because they can be overridden by custom or hidden tokens.
  // Custom tokens are second because they can become hidden-custom
  // Hidden tokens are last because they can become hidden-custom if a custom token with the same address exists.
  const specialErc20Hints: GetOptions['specialErc20Hints'] = {}

  if (toBeLearnedTokens && toBeLearnedTokens[chainId.toString()]) {
    toBeLearnedTokens[chainId.toString()].forEach((token) => {
      specialErc20Hints[token] = 'learn'
    })
  }

  customTokens.forEach((token) => {
    if (token.chainId === chainId && token.standard === 'ERC20') {
      specialErc20Hints[token.address] = 'custom'
    }
  })

  tokenPreferences.forEach((token) => {
    if (token.chainId === chainId && token.isHidden) {
      if (specialErc20Hints[token.address]) {
        specialErc20Hints[token.address] = 'hidden-custom'
      } else {
        specialErc20Hints[token.address] = 'hidden'
      }
    }
  })

  return specialErc20Hints
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
