import { LEDGER_LIVE_HD_PATH } from '../consts/derivation'

export const getHdPath = (derivationPath: string, index: number) => {
  if (derivationPath === LEDGER_LIVE_HD_PATH) {
    return `m/44'/60'/${index}'/0/0`
  }

  return `${derivationPath}/${index}`
}
