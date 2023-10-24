import { ExternalKey } from '../interfaces/keystore'

export const getHdPathFromTemplate = (
  derivationPathTemplate: ExternalKey['meta']['hdPathTemplate'],
  index: number
) => {
  return derivationPathTemplate.replace('<account>', index.toString())
}

// TODO: Remove this
export const getHdPathFormula = (derivationPath: string) => {
  return `${derivationPath}/x`
}
