import { PrivacyProviderId, PrivateAccountRef } from '../../interfaces/privateAccount'

/** The seed id of `privateAccount` when it belongs to `providerId`, else null. */
export const getPrivateAccountSeedId = (
  privateAccount: PrivateAccountRef | null,
  providerId: PrivacyProviderId
): string | null => (privateAccount?.providerId === providerId ? privateAccount.seedId : null)

/** Whether two refs point at the same private account. */
export const isSamePrivateAccount = (
  a: PrivateAccountRef | null,
  b: PrivateAccountRef | null
): boolean => a?.providerId === b?.providerId && a?.seedId === b?.seedId
