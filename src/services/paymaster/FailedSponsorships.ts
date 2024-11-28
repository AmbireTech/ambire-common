// a singleton for recording failed sponsorships
// so the app can fallback to a standard Paymaster if a sponsorship fails
export class FailedSponsorships {
  failedSponsorshipIds: number[] = []

  add(id: number) {
    this.failedSponsorshipIds.push(id)
  }

  has(id: number): boolean {
    return this.failedSponsorshipIds.includes(id)
  }
}

export const failedSponsorships = new FailedSponsorships()
