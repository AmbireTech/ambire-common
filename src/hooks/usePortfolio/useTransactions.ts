// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useMemo, useEffect } from "react"

export default function useTransactions({ account, currentNetwork, relayerURL, useRelayerData, requests, sentTxn }: any): any {

    const url = relayerURL
    ? `${relayerURL}/identity/${account}/${currentNetwork}/transactions`
    : null
    const { data, forceRefresh } = useRelayerData({ url })

    // Pending transactions which aren't executed yet
    const allPending = useMemo(() => data && data.txns.filter(x => !x.executed && !x.replaced)
    , [data?.txns])

    useEffect(() => {
        forceRefresh()
    },[requests, sentTxn])

    return {
        pendingTransactions: allPending?.length ? [allPending] : [],
    }
}