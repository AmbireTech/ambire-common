// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback } from 'react'
import {
    Token,
    TokenWithIsHiddenFlag,
} from './types'

export default function useTransactions({ account, currentNetwork, relayerURL, useRelayerData }: any): any {

    const url = relayerURL
    ? `${relayerURL}/identity/${account}/${currentNetwork}/transactions`
    : null
    const { data, errMsg, isLoading } = useRelayerData({ url })
    console.log(data)
    // Pending transactions which aren't executed yet
    const allPending = data && data.txns.filter(tx => !tx.executed && !tx.replaced && !tx.executed?.mined)

    console.log('allPending', allPending)

    return {
        pendingTransactions: allPending,
    }
}