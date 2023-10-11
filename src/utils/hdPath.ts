import { LEDGER_LIVE_HD_PATH } from '../consts/derivation'

export const getHdPath = (derivationPath: string, slot: number) => {
  if (derivationPath === LEDGER_LIVE_HD_PATH) {
    return `m/44'/60'/${slot}'/0/0`
  }

  // TODO: add support for other derivation paths
  return `${derivationPath}/${slot}`
}
