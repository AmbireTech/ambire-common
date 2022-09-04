import { useCallback } from 'react'
import {
    Token,
    TokenWithIsHiddenFlag,
} from './types'

export default function useHiddenTokens({ useToasts, useStorage }: any): any {
  const [hiddenTokens, setHiddenTokens] = useStorage({ key: 'hiddenTokens', defaultValue: [] })
  const { addToast } = useToasts()

  const onAddHiddenToken = useCallback(
    (hiddenToken: TokenWithIsHiddenFlag) => {
      const { symbol } = hiddenToken
      const updatedHiddenTokens = [
        ...hiddenTokens,
        {
          ...hiddenToken,
          isHidden: true
        }
      ]

      setHiddenTokens(updatedHiddenTokens)
      addToast(`${symbol} token is hidden from your assets list!`)
    },
    [hiddenTokens, setHiddenTokens]
  )

  const filterByHiddenTokens = useCallback((_tokens: Token[]) => {
    return _tokens
      .map((t: Token) => {
        return hiddenTokens.find((ht: TokenWithIsHiddenFlag) => t.address === ht.address) || { ...t, isHidden: false }
      })
      .filter((t) => !t.isHidden)
  }, [hiddenTokens])

  const onRemoveHiddenToken = useCallback(
    (address: string) => {
      const token = hiddenTokens?.find((t: any) => t.address === address)
      if (!token) return addToast(`${address} is not present in your assets list.`)

      const updatedHiddenTokens = hiddenTokens?.filter((t: any) => t.address !== address)

      setHiddenTokens(updatedHiddenTokens)
      addToast(`${token.symbol} is shown to your assets list.`)
    },
    [hiddenTokens, setHiddenTokens]
  )

  return {
    onAddHiddenToken,
    onRemoveHiddenToken,
    setHiddenTokens,
    hiddenTokens,
    filterByHiddenTokens,
  }
}