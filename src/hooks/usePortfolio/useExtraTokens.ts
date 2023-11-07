// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback } from 'react'

import { NetworkId } from '../../constants/networks'
import { Token, UseExtraTokensProps } from './types'

export default function useExtraTokens({
  useStorage,
  useToasts,
  tokens,
  constants
}: UseExtraTokensProps) {
  const [extraTokens, setExtraTokens] = useStorage({ key: 'extraTokens', defaultValue: [] })

  const { addToast } = useToasts()

  const getExtraTokensAssets = useCallback(
    (account: string, network: NetworkId) =>
      extraTokens
        .filter((extra: Token) => extra.account === account && extra.network === network)
        .map((extraToken: Token) => ({
          ...extraToken,
          type: 'token',
          price: 0,
          balanceUSD: 0,
          isExtraToken: true
        })),
    [extraTokens]
  )

  const checkIsTokenEligibleForAddingAsExtraToken = useCallback<
    UsePortfolioReturnType['checkIsTokenEligibleForAddingAsExtraToken']
  >(
    (extraToken, _extraTokens) => {
      const { address, name, symbol } = extraToken

      if (_extraTokens.map((t) => t.address).includes(address.toLowerCase()))
        return {
          isEligible: false,
          reason: `${name} (${symbol}) is already added to your wallet.`
        }

      if (
        constants?.tokenList &&
        Object.values(constants.tokenList)
          .flat(1)
          .map((t) => t.address)
          .includes(address.toLowerCase())
      )
        return {
          isEligible: false,
          reason: `${name} (${symbol}) is already handled by your wallet.`
        }

      if (tokens.map((t) => t.address).includes(address.toLowerCase()))
        return {
          isEligible: false,
          reason: `You already have ${name} (${symbol}) in your wallet.`
        }

      return {
        isEligible: true
      }
    },
    [constants.tokenList, tokens]
  )

  const onAddExtraToken = useCallback(
    (extraToken: Token) => {
      setExtraTokens((prevTokens) => {
        const eligibleStatus = checkIsTokenEligibleForAddingAsExtraToken(extraToken, prevTokens)

        if (!eligibleStatus.isEligible) {
          addToast(eligibleStatus.reason)
          return prevTokens
        }

        const updatedExtraTokens = [
          ...prevTokens,
          {
            ...extraToken,
            coingeckoId: null
          }
        ]

        addToast(`${extraToken.name} (${extraToken.symbol}) token added to your wallet!`)
        return updatedExtraTokens
      })
    },
    [checkIsTokenEligibleForAddingAsExtraToken, setExtraTokens, addToast]
  )

  const onRemoveExtraToken = useCallback(
    (address) => {
      setExtraTokens((prevTokens) => {
        const token = prevTokens.find((t) => t.address === address)
        if (!token) {
          addToast(`${address} is not present in your wallet.`)
          return prevTokens
        }
        const updatedExtraTokens = prevTokens.filter((t) => t.address !== address)

        addToast(`${token.name} (${token.symbol}) was removed from your wallet.`)
        return updatedExtraTokens
      })
    },
    [setExtraTokens, addToast]
  )

  return {
    checkIsTokenEligibleForAddingAsExtraToken,
    onAddExtraToken,
    onRemoveExtraToken,
    extraTokens,
    getExtraTokensAssets
  }
}
