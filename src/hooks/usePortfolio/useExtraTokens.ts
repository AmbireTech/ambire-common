// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback } from 'react'
import {
    Token,
    UseExtraTokensProps,
} from './types'
import { NetworkId } from 'ambire-common/src/constants/networks'

interface UpdatedExtraToken extends Token {
  coingeckoId: string;
}
export default function useExtraTokens({ useStorage, useToasts, tokens, constants }: UseExtraTokensProps) {
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


  const onAddExtraToken = useCallback(
    (extraToken: Token) => {
      const { address, name, symbol } = extraToken
      if (extraTokens.map(({ address }: any) => address).includes(address))
        return addToast(`${name} (${symbol}) is already added to your wallet.`)
      if (
        constants?.tokenList && Object.values(constants.tokenList)
          .flat(1)
          .map(({ address }: any) => address)
          .includes(address)
      )
        return addToast(`${name} (${symbol}) is already handled by your wallet.`)
      if (tokens.map(({ address }) => address).includes(address))
        return addToast(`You already have ${name} (${symbol}) in your wallet.`)

      const updatedExtraTokens = [
        ...extraTokens,
        {
          ...extraToken,
          coingeckoId: null
        }
      ]

      setExtraTokens(updatedExtraTokens)
      addToast(`${name} (${symbol}) token added to your wallet!`)
    },
    [setExtraTokens, tokens, extraTokens]
  )

  const onRemoveExtraToken = useCallback(
    (address) => {
      const token = extraTokens.find((t) => t.address === address)
      if (!token) return addToast(`${address} is not present in your wallet.`)

      const updatedExtraTokens = extraTokens.filter((t) => t.address !== address)

      setExtraTokens(updatedExtraTokens)
      addToast(`${token.name} (${token.symbol}) was removed from your wallet.`)
    },
    [extraTokens, setExtraTokens]
  )


  return {
    onAddExtraToken,
    onRemoveExtraToken,
    extraTokens,
    getExtraTokensAssets,
  }
}