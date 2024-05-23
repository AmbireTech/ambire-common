import { Contract, ZeroAddress } from 'ethers'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Account, AccountId } from '../../interfaces/account'
import { NetworkId } from '../../interfaces/networkDescriptor'
import { RPCProvider } from '../../interfaces/settings'
import { isSmartAccount } from '../account/account'
import { TokenResult } from './interfaces'

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

export const getTotal = (t: TokenResult[]) =>
  t.reduce((cur: { [key: string]: number }, token: TokenResult) => {
    const localCur = cur // Add index signature to the type of localCur
    if (token.isHidden) return localCur
    // eslint-disable-next-line no-restricted-syntax
    for (const x of token.priceIn) {
      const currentAmount = localCur[x.baseCurrency] || 0

      const tokenAmount = Number(getTokenAmount(token)) / 10 ** token.decimals
      localCur[x.baseCurrency] = currentAmount + tokenAmount * x.price
    }

    return localCur
  }, {})

export const getPinnedGasTankTokens = (
  availableGasTankAssets: TokenResult[],
  hasNonZeroTokens: boolean,
  accountId: AccountId,
  gasTankTokens: TokenResult[]
) => {
  if (!availableGasTankAssets) return []
  // Don't set pinnedGasTankTokens if the user has > 1 non-zero tokens
  if (hasNonZeroTokens) return []

  return availableGasTankAssets.reduce((acc: TokenResult[], token: any) => {
    const isGasTankToken = !!gasTankTokens.find(
      (gasTankToken: TokenResult) =>
        gasTankToken.symbol.toLowerCase() === token.symbol.toLowerCase()
    )
    const isAlreadyPinned = !!acc.find(
      (accToken) => accToken.symbol.toLowerCase() === token.symbol.toLowerCase()
    )

    if (isGasTankToken || isAlreadyPinned) return acc

    const correspondingPinnedToken = PINNED_TOKENS.find(
      (pinnedToken) =>
        (!('accountId' in pinnedToken) || pinnedToken.accountId === accountId) &&
        pinnedToken.address === token.address &&
        pinnedToken.networkId === token.network
    )

    if (correspondingPinnedToken && correspondingPinnedToken.onGasTank) {
      acc.push({
        address: token.address,
        symbol: token.symbol.toUpperCase(),
        amount: 0n,
        networkId: correspondingPinnedToken.networkId,
        decimals: token.decimals,
        priceIn: [
          {
            baseCurrency: 'usd',
            price: token.price
          }
        ],
        flags: {
          rewardsType: null,
          canTopUpGasTank: true,
          isFeeToken: true,
          onGasTank: true
        }
      })
    }
    return acc
  }, [])
}
