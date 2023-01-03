// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useMemo, useEffect, useState } from 'react'

export default function useTransactions({
  account,
  currentNetwork,
  relayerURL,
  useRelayerData,
  requests,
  sentTxn
}: any): any {
  const [txns, setTxns] = useState([])
  const url = relayerURL ? `${relayerURL}/identity/${account}/${currentNetwork}/transactions` : null
  const { data, isLoading, forceRefresh } = useRelayerData({ url })

  // Pending transactions which aren't executed yet
  const allPending = useMemo(
    () => txns && txns.filter((x: any) => !x.executed && !x.replaced),
    [txns]
  )

  // Set in state transactions so we don't lose them on refetch
  useEffect(() => {
    if (!isLoading && data && data.txns) {
      setTxns(data.txns)
    }
  }, [data?.txns, isLoading, data])

  // Get the transactions from relayer on requests array change and on new transaction sent
  useEffect(() => {
    forceRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, sentTxn])

  // Set interval to refetch transactions in order to get the new state of pending ones
  useEffect(() => {
    const interval = 5000
    const pendingTxsInterval =
      allPending?.length &&
      setInterval(() => {
        allPending?.length && forceRefresh()
      }, interval)
    return () => clearInterval(pendingTxsInterval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPending])

  return {
    pendingTransactions: allPending?.length ? [allPending] : []
  }
}
