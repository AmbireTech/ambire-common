import isURL from 'validator/es/lib/isURL'

import { AmbireDappManifest } from '../dappCatalog/types'

export function isValidUrl(input: string): boolean {
  const isValid = isURL(input, { protocols: ['https'] })
  return isValid
}

export function isValidCustomDappData(input: AmbireDappManifest): {
  success: boolean
  errors: { [prop: string]: string }
} {
  const { url, name, iconUrl, connectionType, networks } = input
  const hasValidUrl = isValidUrl(url)
  // NOTE: empty string for iconUrl means error on user input url - please make validation on app side
  const hasValidIconUrl = isValidUrl(iconUrl) || iconUrl === ''
  const hasValidName = !!name.length
  const validConnectionType = !!connectionType
  const hasNetworksSelected = !!networks.length

  return {
    success: hasValidUrl && hasValidName && validConnectionType && hasValidIconUrl && hasNetworksSelected,
    errors: {
      ...(hasValidUrl ? {} : { url: 'Invalid Url' }),
      ...(hasValidIconUrl ? {} : { iconUrl: 'Invalid icon Url' }),
      ...(hasValidName ? {} : { name: 'Invalid Name' }),
      ...(validConnectionType ? {} : { connectionType: 'Connection type not selected' }),
      ...(hasNetworksSelected ? {} : { networks: 'Networks not selected' })
    }
  }
}
