import { formatUnits } from 'ethers/lib/utils'
import { useMemo } from 'react'

import { getAddedGas } from '../../helpers/sendTxnHelpers'
import { getGasTankFilledTxns } from '../../services/isFeeCollectorTxn'
import useCacheBreak from '../useCacheBreak'
import { UseGasTankDataProps, UseGasTankDataReturnType } from './types'

export default function useGasTankData({
  relayerURL,
  useAccounts,
  useNetwork,
  usePortfolio,
  useRelayerData
}: UseGasTankDataProps): UseGasTankDataReturnType {
  const { cacheBreak } = useCacheBreak()
  const { selectedAcc: account } = useAccounts()
  const { network } = useNetwork()
  const { tokens } = usePortfolio()

  const urlGetBalance = relayerURL
    ? `${relayerURL}/gas-tank/${account}/getBalance?cacheBreak=${cacheBreak}`
    : null
  const urlGetFeeAssets = relayerURL
    ? `${relayerURL}/gas-tank/assets?cacheBreak=${cacheBreak}`
    : null
  const urlGetTransactions = relayerURL
    ? `${relayerURL}/identity/${account}/${network?.id}/transactions`
    : null

  const { data: balancesRes, isLoading } = useRelayerData({ url: urlGetBalance })
  const { data: feeAssetsRes } = useRelayerData({ url: urlGetFeeAssets })
  const { data: executedTxnsRes } = useRelayerData({ url: urlGetTransactions })

  const gasTankBalances = useMemo(
    () =>
      balancesRes &&
      balancesRes.length &&
      balancesRes.map(({ balanceInUSD }: any) => balanceInUSD).reduce((a: any, b: any) => a + b, 0),
    [balancesRes]
  )

  const gasTankTxns = useMemo(
    () =>
      executedTxnsRes &&
      executedTxnsRes.txns.length &&
      executedTxnsRes.txns.filter((item: any) => !!item.gasTankFee),
    [executedTxnsRes]
  )

  const feeAssetsPerNetwork = useMemo(
    () =>
      feeAssetsRes &&
      feeAssetsRes.length &&
      feeAssetsRes.filter((item: any) => item.network === network?.id),
    [feeAssetsRes, network?.id]
  )

  const executedTxns = executedTxnsRes && executedTxnsRes.txns.length && executedTxnsRes.txns
  const gasTankFilledTxns = useMemo(
    () => executedTxns && executedTxns.length && getGasTankFilledTxns(executedTxns),
    [executedTxns]
  )

  const availableFeeAssets = useMemo(
    () =>
      feeAssetsPerNetwork?.map((item: any) => {
        const isFound = tokens?.find((x) => x.address.toLowerCase() === item.address.toLowerCase())
        if (isFound) return isFound
        return { ...item, balance: 0, balanceUSD: 0, decimals: 0 }
      }),
    [feeAssetsPerNetwork, tokens]
  )

  const sortedTokens = useMemo(
    () =>
      availableFeeAssets?.sort((a: any, b: any) => {
        const decreasing = b.balanceUSD - a.balanceUSD
        if (decreasing === 0) return a.symbol.localeCompare(b.symbol)
        return decreasing
      }),
    [availableFeeAssets]
  )

  const totalSavedResult = useMemo(
    () =>
      gasTankTxns &&
      gasTankTxns.length &&
      gasTankTxns.map((item: any) => {
        const feeTokenDetails = feeAssetsRes
          ? feeAssetsRes.find((i: any) => i.symbol === item.feeToken)
          : null
        const savedGas = feeTokenDetails ? getAddedGas(feeTokenDetails) : null
        return {
          saved: savedGas ? item.feeInUSDPerGas * savedGas : 0.0,
          cashback:
            item.gasTankFee && item.gasTankFee.cashback
              ? formatUnits(
                  item.gasTankFee.cashback.toString(),
                  feeTokenDetails?.decimals
                ).toString() * feeTokenDetails?.price
              : 0.0
        }
      }),
    [feeAssetsRes, gasTankTxns]
  )

  return {
    balancesRes,
    gasTankBalances,
    isLoading,
    sortedTokens,
    gasTankTxns,
    feeAssetsRes,
    gasTankFilledTxns,
    totalSavedResult
  }
}
