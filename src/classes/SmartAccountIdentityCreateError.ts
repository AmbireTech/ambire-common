import { AmbireSmartAccountIdentityCreateRequest } from '../interfaces/account'

export default class SmartAccountIdentityCreateError extends Error {
  identityRequests: AmbireSmartAccountIdentityCreateRequest[] = []

  constructor(identityRequests: AmbireSmartAccountIdentityCreateRequest[]) {
    super()
    this.name = 'SmartAccountIdentityCreateError'
    this.identityRequests = identityRequests
  }
}
