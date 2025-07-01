export const PIMLICO = 'pimlico'
export const BICONOMY = 'biconomy'
export const ETHERSPOT = 'etherspot'

export type BUNDLER = typeof PIMLICO | typeof BICONOMY | typeof ETHERSPOT

export const allBundlers = [PIMLICO, BICONOMY, ETHERSPOT]
