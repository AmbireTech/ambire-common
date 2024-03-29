/* eslint-disable import/no-extraneous-dependencies */

import { ZeroAddress } from 'ethers'
import fetch from 'node-fetch'

import { NetworkDescriptor } from '../../interfaces/networkDescriptor'

const customIcons: any = {
  '0xb468a1e5596cfbcdf561f21a10490d99b4bb7b68':
    'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Jeff_Sessions_with_Elmo_and_Rosita_%28cropped%29.jpg/220px-Jeff_Sessions_with_Elmo_and_Rosita_%28cropped%29.jpg', // TEST Polygon ELMO token,
  '0x88800092ff476844f74dc2fc427974bbee2794ae':
    'https://raw.githubusercontent.com/AmbireTech/ambire-brand/main/logos/ambire_logo_white_bg_250x250.png', // Ambire Wallet Token
  '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935':
    'https://raw.githubusercontent.com/AmbireTech/ambire-brand/main/logos/xwallet_250x250.png', // xWallet
  '0xb6456b57f03352be48bf101b46c1752a0813491a':
    'https://raw.githubusercontent.com/AmbireTech/adex-brand/master/logos/vaporwave-adex-2.png', // ADX-STAKING
  '0xd9a4cb9dc9296e111c66dfacab8be034ee2e1c2c':
    'https://raw.githubusercontent.com/AmbireTech/adex-brand/master/logos/ADX-loyalty%40256x256.png', // ADX-LOYALTY
  '0xec3b10ce9cabab5dbf49f946a623e294963fbb4e':
    'https://raw.githubusercontent.com/AmbireTech/ambire-brand/main/logos/xwallet_250x250.png', // Polygons test xWallet
  '0xe9415e904143e42007865e6864f7f632bd054a08':
    'https://raw.githubusercontent.com/AmbireTech/ambire-brand/main/logos/Ambire_logo_250x250.png', // Polygons test Wallet
  '0xade00c28244d5ce17d72e40330b1c318cd12b7c3':
    'https://raw.githubusercontent.com/AmbireTech/ambire-brand/main/official-logos/Ambire-AdEx/Ambire_AdEx_Symbol_color_white_bg.png' // ADX-TOKEN
}

const zapperStorageTokenIcons = 'https://storage.googleapis.com/zapper-fi-assets/tokens'

export function getIconId(networkId: string, address: string): string {
  return `${networkId.toLowerCase()}:${address.toLowerCase()}`
}

export function getHardcodedIcon(address: string): string | null {
  return customIcons[address.toLowerCase()] || null
}

export function getZapperIcon(networkId: string, address: string) {
  return `${zapperStorageTokenIcons}/${networkId.toLowerCase()}/${address.toLowerCase()}.png`
}

export async function getIcon(
  network: NetworkDescriptor,
  addr: string,
  storageIcons: any
): Promise<string | null> {
  // if it's a hardcoded token, return it
  const hardcodedIcon = getHardcodedIcon(addr)
  if (hardcodedIcon) return hardcodedIcon

  // try to take the icon from the storage first
  if (storageIcons) {
    const storageImage = storageIcons[getIconId(network.id, addr)] ?? null
    if (storageImage) return storageImage
  }

  // make a request to cena to fetch the icon
  const baseUrlCena = 'https://cena.ambire.com/api/v3'
  const url =
    addr === ZeroAddress
      ? `${baseUrlCena}/coins/${network.platformId}`
      : `${baseUrlCena}/coins/${network.platformId}/contract/${addr}`

  const response = await fetch(url)
  if (response.status === 200) {
    const json = await response.json()
    if (json && json.image && json.image.small) return json.image.small
  }

  // try to find the icon without making a request
  return getZapperIcon(network.id, addr)
}
