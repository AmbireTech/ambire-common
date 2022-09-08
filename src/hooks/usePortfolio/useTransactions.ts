import { useCallback } from 'react'
import {
    Token,
    TokenWithIsHiddenFlag,
} from './types'

export default function useTransactions({ account, currentNetwork, relayerURL, useRelayerData }: any): any {
    //   console.log(relayerURL)

    const url = relayerURL
    ? `${relayerURL}/identity/${account}/${currentNetwork}/transactions`
    : null
    const { data, errMsg, isLoading } = useRelayerData({ url })
    console.log(data)
    return {
        transactions: data
    }
}