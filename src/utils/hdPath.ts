import { LEDGER_LIVE_HD_PATH } from '../consts/derivation'
import { ExternalKey } from '../interfaces/keystore'

export const getHdPath = (derivationPath: string, index: number) => {
  if (derivationPath === LEDGER_LIVE_HD_PATH) {
    return `m/44'/60'/${index}'/0/0`
  }

  return `${derivationPath}/${index}`
}

export const getHdPathFromTemplate = (
  derivationPathTemplate: ExternalKey['meta']['hdPathTemplate'],
  index: number
) => {
  return derivationPathTemplate.replace('<account>', index.toString())
}

// TODO: Remove this
export const getHdPathFormula = (derivationPath: string) => {
  if (derivationPath === LEDGER_LIVE_HD_PATH) {
    return "m/44'/60'/x/0/0"
  }

  return `${derivationPath}/x`
}
