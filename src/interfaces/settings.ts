import { Key } from './keystore'

export type KeyPreferences = {
  addr: Key['addr']
  type: Key['type']
  label: string
}[]
