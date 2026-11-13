import type { Sponsor } from '../libs/erc7677/types'

/**
 * The sponsor shown when Ambire itself pays for a transaction (like a sponsored swap). The apps
 * recognise it by its `icon` and show the Ambire logo they ship with instead of loading this URL.
 */
export const AMBIRE_SPONSOR: Sponsor = {
  name: 'Ambire Wallet',
  icon: 'https://cena.ambire.com/public/ambire-logos/symbol-color.svg'
}
