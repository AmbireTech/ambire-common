import { formatUnits } from 'ethers/lib/utils'
import { useMemo } from 'react'

import { getAddedGas } from '../../helpers/sendTxnHelpers'
import { getGasTankFilledTxns } from '../../services/isFeeCollectorTxn'
import useCacheBreak from '../useCacheBreak'
import { UseGasTankDataProps, UseGasTankDataReturnType } from './types'

export default function useGasTankData({
  relayerURL,
  selectedAcc,
  network,
  portfolio,
  useRelayerData
}: UseGasTankDataProps): UseGasTankDataReturnType {
  const { cacheBreak } = useCacheBreak()
  const { tokens } = portfolio

  const urlGetBalance = relayerURL
    ? `${relayerURL}/gas-tank/${selectedAcc}/getBalance?cacheBreak=${cacheBreak}`
    : null
  const urlGetFeeAssets = relayerURL
    ? `${relayerURL}/gas-tank/assets?cacheBreak=${cacheBreak}`
    : null
  const urlGetTransactions = relayerURL
    ? `${relayerURL}/identity/${selectedAcc}/${network?.id}/transactions`
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
        if (isFound)
          return {
            ...isFound,
            tokenImageUrl: item.icon,
            decimals: item.decimals,
            symbol: item.symbol,
            balance: isFound.balance,
            disableGasTankDeposit: !!item.disableGasTankDeposit,
            balanceUSD:
              parseFloat(isFound.balance) *
              parseFloat(
                feeAssetsPerNetwork.find(
                  (x: any) => x.address.toLowerCase() === isFound.address.toLowerCase()
                ).price || 0
              )
          }

        return {
          ...item,
          tokenImageUrl: item.icon,
          balance: 0,
          balanceUSD: 0,
          decimals: 0,
          address: item.address.toLowerCase(),
          symbol: item.symbol.toUpperCase()
        }
      }),
    [feeAssetsPerNetwork, tokens]
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
              ? // @ts-ignore FIXME: Figure out why TypeScript complains
                formatUnits(
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
    gasTankTxns,
    feeAssetsRes,
    gasTankFilledTxns,
    totalSavedResult,
    availableFeeAssets
  }
}
