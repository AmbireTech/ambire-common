import networks, { NetworkId } from '../../constants/networks'
import walletGnosisDefaultCatalog from './ambire-wallet-gnosis-default.applist.json'
import walletWalletconnectDefaultCatalog from './ambire-wallet-walletconnect-default.applist.json'
import gnosisDefaultList from './gnosis-default.applist.json'
import { AmbireDappManifest, WalletConnectionType } from './types'

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
