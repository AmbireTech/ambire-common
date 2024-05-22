import { Contract, ZeroAddress } from 'ethers'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Account } from '../../interfaces/account'
import { NetworkId } from '../../interfaces/networkDescriptor'
import { RPCProvider } from '../../interfaces/settings'
import { isSmartAccount } from '../account/account'
import { CustomToken } from './customToken'
import { PortfolioGetResult, PreviousHintsStorage, TokenResult } from './interfaces'

const usdcEMapping: { [key: string]: string } = {
  avalanche: '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664',
  moonriver: '0x748134b5f553f2bcbd78c6826de99a70274bdeb3',
  arbitrum: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
  polygon: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  optimism: '0x7f5c764cbc14f9669b88837ca1490cca17c31607'
}

export function overrideSymbol(address: string, networkId: string, symbol: string) {
  // Since deployless lib calls contract and USDC.e is returned as USDC, we need to override the symbol
  if (usdcEMapping[networkId] && usdcEMapping[networkId].toLowerCase() === address.toLowerCase()) {
    return 'USDC.E'
  }

  return symbol
}

export function getFlags(
  networkData: any,
  networkId: NetworkId,
  tokenNetwork: NetworkId,
  address: string
) {
  const isRewardsOrGasTank = ['gasTank', 'rewards'].includes(networkId)
  const onGasTank = networkId === 'gasTank'

  let rewardsType = null
  if (networkData?.xWalletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
    rewardsType = 'wallet-rewards'
  if (networkData?.walletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
    rewardsType = 'wallet-vesting'

  const foundFeeToken = gasTankFeeTokens.find(
    (t) =>
      t.address.toLowerCase() === address.toLowerCase() &&
      (isRewardsOrGasTank ? t.networkId === tokenNetwork : t.networkId === networkId)
  )

  const canTopUpGasTank = foundFeeToken && !foundFeeToken?.disableGasTankDeposit
  const isFeeToken = address === ZeroAddress || !!foundFeeToken

  return {
    onGasTank,
    rewardsType,
    canTopUpGasTank,
    isFeeToken
  }
}

export const validateERC20Token = async (
  token: { address: string; networkId: NetworkId },
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

export const shouldGetAdditionalPortfolio = (account: Account) => {
  return isSmartAccount(account)
}

// fetch the amountPostSimulation for the token if set
// otherwise, the token.amount
export const getTokenAmount = (token: TokenResult): bigint => {
  return typeof token.amountPostSimulation === 'bigint' ? token.amountPostSimulation : token.amount
}

// Updates the previous hints storage with the latest portfolio get result.
export function getUpdatedHints(
  result: PortfolioGetResult,
  networkId: NetworkId,
  storagePreviousHints: PreviousHintsStorage,
  key: string,
  tokenPreferences: CustomToken[]
) {
  const hints = { ...storagePreviousHints }
  if (!hints.fromExternalAPI) hints.fromExternalAPI = {}
  if (!hints.learnedTokens) hints.learnedTokens = {}

  const erc20s = result.tokens.filter((token) => token.amount > 0n).map((token) => token.address)

  const erc721s = Object.fromEntries(
    result.collections.map((collection) => [
      collection.address,
      result.hints.erc721s[collection.address]
    ])
  )
  const previousHintsFromExternalAPI =
    (hints.fromExternalAPI && hints.fromExternalAPI[key] && hints.fromExternalAPI[key]?.erc20s) ||
    []

  hints.fromExternalAPI[key] = { erc20s, erc721s }

  if (Object.keys(previousHintsFromExternalAPI).length > 0) {
    // eslint-disable-next-line no-restricted-syntax
    for (const address of erc20s) {
      const isPinned = PINNED_TOKENS.some(
        (pinned) => pinned.address === address && pinned.networkId === networkId
      )
      const isTokenPreference = tokenPreferences.some(
        (preference) => preference.address === address && preference.networkId === networkId
      )

      if (!previousHintsFromExternalAPI.includes(address) && !isPinned && !isTokenPreference) {
        if (!hints.learnedTokens[networkId]) hints.learnedTokens[networkId] = {}
        hints.learnedTokens[networkId][address] = Date.now().toString()
      }
    }
  }

  return hints
}

export const tokenFilter = (
  token: TokenResult,
  network: { id: NetworkId },
  hasNonZeroTokens: boolean,
  additionalHints: string[] | undefined,
  tokenPreferences: CustomToken[]
): boolean => {
  const isTokenPreference = tokenPreferences?.find((tokenPreference) => {
    return tokenPreference.address === token.address && tokenPreference.networkId === network.id
  })
  if (isTokenPreference) {
    token.isHidden = isTokenPreference.isHidden
  }

  // always include > 0 amount and native token
  if (token.amount > 0 || token.address === ZeroAddress) return true

  const isPinned = !!PINNED_TOKENS.find((pinnedToken) => {
    return pinnedToken.networkId === network.id && pinnedToken.address === token.address
  })

  const isInAdditionalHints = additionalHints?.includes(token.address)

  // if the amount is 0
  // return the token if it's pinned and requested
  const pinnedRequested = isPinned && !hasNonZeroTokens

  return !!isTokenPreference || isInAdditionalHints || pinnedRequested
}
