import { Account } from './account'

type AccountPreferences = {
  [key in Account['addr']]: {
    label: string
    avatarId: string
  }
}

export interface Settings {
  accountPreferences: AccountPreferences | {}

  // TODO: To be discussed
  // appPreferences: {
  // theme: 'dark' | 'white' | 'auto'
  // dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY'
  // currency: 'USD' | 'EUR'
  // }

  // TODO: To be discussed
  // general: {
  // isDefaultWallet: boolean // override MetaMask and other wallet extensions
  // behaveLikeMetaMask: boolean // if we should tell dapps `isMetaMask: true` or not
  // }
}
