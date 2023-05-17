// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useMemo } from 'react'
import networks from '../../constants/networks'

const defaultTotal = (network) => ({
  network,
  total: {
    full: 0,
    truncated: 0,
    decimals: '00'
  }
})

export default function useBalance(
  account,
  assets,
  assetsCurrentAccount,
  currentNetwork,
  filterByHiddenTokens
) {
  const balanceByNetworks = useMemo(() => {
    return (
      Object.keys(assets)
        .filter((key) => key.includes(account) && !key.includes(currentNetwork))
        .map((key) => {
          const network = assets[key]?.network
          const totalUSD = filterByHiddenTokens(assets[key]?.tokens || [])?.reduce(
            (acc, curr) => acc + curr.balanceUSD,
            0
          )

          if (!totalUSD) return defaultTotal(network)

          const [truncated, decimals] = Number(totalUSD.toString()).toFixed(2).split('.')
          return {
            network,
            total: {
              full: totalUSD,
              truncated: Number(truncated).toLocaleString('en-US'),
              decimals
            }
          }
        }) || []
    )
  }, [assets, account, currentNetwork, filterByHiddenTokens])

  const currBalance = useMemo(() => {
    const totalUSD = filterByHiddenTokens(assetsCurrentAccount?.tokens || [])?.reduce(
      (acc, curr) => acc + curr.balanceUSD,
      0
    )

    if (!totalUSD) return defaultTotal(currentNetwork)

    const [truncated, decimals] = Number(totalUSD.toString()).toFixed(2).split('.')

    return {
      network: currentNetwork,
      total: {
        full: totalUSD,
        truncated: Number(truncated).toLocaleString('en-US'),
        decimals
      }
    }
  }, [assetsCurrentAccount, currentNetwork, filterByHiddenTokens])

  const balancesByNetworks = useMemo(() => {
    if (currBalance) {
      return (
        balanceByNetworks
          // When switching networks, the balances order is not persisted.
          // This creates an annoying jump effect sometimes in the list
          // of the positive other balances for the account. So always sort
          // the other balances, to make sure their order in the list is
          // the same on every network switch.
          ?.sort((a, b) =>
            networks.find(({ id }) => id === a.network)?.chainId <
            networks.find(({ id }) => id === b.network)?.chainId
              ? -1
              : 1
          )
      )
    }
    return []
  }, [balanceByNetworks, currBalance])

  return {
    balance: currBalance,
    otherBalances: balancesByNetworks
  }
}
