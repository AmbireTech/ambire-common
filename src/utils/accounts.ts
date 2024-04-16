import { Key } from 'interfaces/keystore'

const getIsViewOnly = (keys: Key[], accountKeys: string[]) => {
  return keys.every((k) => !accountKeys.includes(k.addr))
}

export { getIsViewOnly }
