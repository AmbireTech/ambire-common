export const BROADCAST_OPTIONS = {
  bySelf: 'self', // standard txn
  bySelf7702: 'self7702', // executeBySender
  byBundler: 'bundler', // userOp
  byRelayer: 'relayer', // execute
  byOtherEOA: 'otherEOA' // execute + standard
}
