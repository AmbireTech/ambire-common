// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useEffect, useMemo, useState } from 'react'
import networks from '../../constants/networks'

const defaultTotal = (network) => ({
    network: network,
    total: {
        full: 0,
        truncated: 0,
        decimals: '00'
    }
})

export default function useBalance(balances, assets, currentNetwork) {
    const balanceByNetworks = useMemo(() => {     
        return balances?.data?.map(({ network, tokens }) => {
            const totalUSD = tokens?.reduce((acc, curr) => acc + curr.balanceUSD, 0)
    
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
    }, [balances, currentNetwork]);

    const currBalance = useMemo(() => {
        const totalUSD = assets?.tokens?.reduce((acc, curr) => acc + curr.balanceUSD, 0)

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
    }, [assets, currentNetwork]);
        
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
        } else return []
            
    }, [balanceByNetworks, currentNetwork]);
        
    const [balance, setBalance] = useState(currBalance)
    const [otherBalances, setOtherBalances] = useState(balancesByNetworks)

    useEffect(() => {
        setBalance(currBalance)
    }, [currBalance])

    useEffect(() => {
        setOtherBalances(balancesByNetworks)
    }, [balancesByNetworks])

    return {
        balance,
        otherBalances
    }
}