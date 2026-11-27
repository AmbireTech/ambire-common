export const DEFAULT_ACCOUNT_LABEL = 'Account'

/** Account data older than this is fetched again when the wallet opens or a request needs it */
export const ACCOUNT_DATA_REFRESH_AGE = 5 * 60 * 1000 // 5 minutes

/** Portfolio data older than this isn't shown. The network shows as loading until it's fresh. */
export const ACCOUNT_DATA_DISPLAY_MAX_AGE = 60 * 60 * 1000 // 1 hour
