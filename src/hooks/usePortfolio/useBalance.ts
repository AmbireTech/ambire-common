// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useEffect, useMemo, useState } from 'react'
import networks from '../../constants/networks'

export default function useBalance(tokensByNetworks, currentNetwork) { 
    const balanceByNetworks = useMemo(() => {
        return tokensByNetworks?.map(({ network, meta, assets }) => {
            const totalUSD = assets.reduce((acc, curr) => acc + curr.balanceUSD, 0)
            const balanceUSD = totalUSD + meta.find(({ label }) => label === 'Debt')?.value
            if (!balanceUSD)
            return {
                network,
                total: {
                    full: 0,
                    truncated: 0,
                    decimals: '00'
                    }
                }
                
            const [truncated, decimals] = Number(balanceUSD.toString()).toFixed(2).split('.')
            return {
                network,
                total: {
                    full: balanceUSD,
                    truncated: Number(truncated).toLocaleString('en-US'),
                    decimals
                }
            }
        })  
    }, [tokensByNetworks]);
    
    const currBalance = useMemo(() => {
        const currNetworkB = balanceByNetworks?.find(({ network }) => network === currentNetwork)
        return currNetworkB ? currNetworkB : {
            total: {
                full: 0,
                truncated: 0,
                decimals: '00'
            },
            network: ''
        }
    }, [balanceByNetworks, currentNetwork]);
        
    const balancesByNetworks = useMemo(() => {
        if (currBalance) {
            return (
                balanceByNetworks
                .filter(({ network }) => network !== currentNetwork)
                // When switching networks, the balances order is not persisted.
                // This creates an annoying jump effect sometimes in the list
                // of the positive other balances for the account. So always sort
                // the other balances, to make sure their order in the list is
                // the same on every network switch.
                .sort((a, b) =>
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

    return { balance, otherBalances }
}