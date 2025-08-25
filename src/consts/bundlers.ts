export const PIMLICO = 'pimlico'
export const BICONOMY = 'biconomy'
export const ETHERSPOT = 'etherspot'
export const GELATO = 'gelato'
export const CANDIDE = 'candide'

export type BUNDLER =
  | typeof PIMLICO
  | typeof BICONOMY
  | typeof ETHERSPOT
  | typeof GELATO
  | typeof CANDIDE

export const allBundlers = [PIMLICO, BICONOMY, ETHERSPOT, GELATO, CANDIDE]
