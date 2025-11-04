import { AmbireSmartAccountIdentityCreateRequest } from '../interfaces/account'

export default class AmbireSmartAccountIdentityCreateError extends Error {
  identityRequests: AmbireSmartAccountIdentityCreateRequest[] = []

  constructor(identityRequests: AmbireSmartAccountIdentityCreateRequest[]) {
    super()
    this.name = 'SmartAccountIdentityCreateError'
    this.identityRequests = identityRequests
  }
}
