export const PIMLICO = 'pimlico'
export const BICONOMY = 'biconomy'
export const ETHERSPOT = 'etherspot'
export const GELATO = 'gelatov2'
export const CANDIDE = 'candide'
export const CUSTOM = 'custom'

export type BUNDLER =
  | typeof PIMLICO
  | typeof BICONOMY
  | typeof ETHERSPOT
  | typeof GELATO
  | typeof CANDIDE
  | typeof CUSTOM

export const allBundlers = [PIMLICO, BICONOMY, ETHERSPOT, GELATO, CANDIDE, CUSTOM]
