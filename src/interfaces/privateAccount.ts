/** The privacy protocols a private account can belong to. */
export type PrivacyProviderId = 'privacyPools' | 'tornadoCash'

/**
 * Points at a private account. A private account has no address: it is identified by its protocol
 * and the recovery phrase it is derived from, at most one per pair.
 */
export type PrivateAccountRef = {
  providerId: PrivacyProviderId
  seedId: string
}
