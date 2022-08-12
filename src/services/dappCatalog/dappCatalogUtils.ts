import networks, { NetworkId } from '../../constants/networks'
import { fetchCaught } from '../fetch'
import walletGnosisDefaultCatalog from './ambire-wallet-gnosis-default.applist.json'
import walletWalletconnectDefaultCatalog from './ambire-wallet-walletconnect-default.applist.json'
import gnosisDefaultList from './gnosis-default.applist.json'
import { AmbireDappManifest, SupportedWeb3Connectivity, WalletConnectionType } from './types'

export const chainIdToWalletNetworkId = (chainId: number): NetworkId | null => {
  return networks.find((n) => n.chainId === chainId)?.id || null
}

export function getGnosisDefaultList(): AmbireDappManifest[] {
  const asWalletDapps = gnosisDefaultList.apps.map((dapp: any) => {
    const walletDapp = {
      ...dapp,
      connectionType: WalletConnectionType.gnosis,
      networks: dapp.networks
        .map((n: number) => chainIdToWalletNetworkId(n))
        .filter((n: string) => !!n) as NetworkId[]
    }

    return walletDapp
  })

  return asWalletDapps
}

export function getWalletGnosisDefaultList(): AmbireDappManifest[] {
  const walletGnosisDapps: AmbireDappManifest[] = walletGnosisDefaultCatalog.apps.map((d: any) => ({
    ...d,
    connectionType: WalletConnectionType.gnosis,
    networks: d.networks as NetworkId[]
  }))

  return walletGnosisDapps
}

export function getWalletWalletconnectDefaultList(): AmbireDappManifest[] {
  const walletGnosisDapps: AmbireDappManifest[] = walletWalletconnectDefaultCatalog.apps.map(
    (d) => ({
      ...d,
      connectionType: WalletConnectionType.walletconnect,
      networks: d.networks as NetworkId[]
    })
  )

  return walletGnosisDapps
}

export const getDappId = (name: string): string => {
  return name.toLowerCase().replace(/s/g, '_') + '_' + Date.now()
}

export const getNormalizedUrl = (inputStr: string): string => {
  const url = inputStr.toLowerCase().split(/[?#]/)[0].replace('/manifest.json', '')
  return url
}

export const canOpenInIframe = async (fetch: any, url: string): Promise<boolean> => {
  const res = await fetchCaught(fetch, url, { method: 'HEAD' })

  // NOTE: looks like it enough to open it in iframe 
  // It fails for cors and x-frame-options
  const canBeLoaded = !!res?.resp?.ok

  return canBeLoaded
}

export const getManifestFromDappUrl = async (fetch: any, dAppUrl: string): Promise<AmbireDappManifest | null> => {
  const normalizedUrl = getNormalizedUrl(dAppUrl)
  const url = normalizedUrl.replace(/\/$/, '')
  const manifestUrl = url + '/manifest.json?' + Date.now()

  const { body } = await fetchCaught(fetch, manifestUrl)

  const hasManifest = !!body && body.name && (Array.isArray(body.icons) || body.iconPath)

  const isGnosisManifest = hasManifest && body.description && body.iconPath
  const isWalletPlugin = hasManifest && body.name && body.description && Array.isArray(body.networks)
    && (isGnosisManifest || (Array.isArray(body.web3Connectivity) && body.web3Connectivity.includes(SupportedWeb3Connectivity.gnosis)))

  const manifest = hasManifest ? {
    url,
    name: body.name,
    description: body.description || body.name,
    iconUrl: body.iconUrl || (url + '/' + (body.iconPath || body.icons[0]?.src).replace(/^\//, '')),
    connectionType: isGnosisManifest ? 'gnosis' : 'walletconnect',
    networks: (body.networks || []).map(chainIdToWalletNetworkId),
    isWalletPlugin,
    web3Connectivity: body.web3Connectivity,
    providedBy: body.providedBy,
  } as AmbireDappManifest : null

  return manifest
}
