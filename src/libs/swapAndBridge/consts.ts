export const lifi = 'lifi'
export const socket = 'socket'
export const squid = 'squid'

export const SwapProviders = [lifi, socket, squid] as const

export type SwapProviderName = (typeof SwapProviders)[number]
