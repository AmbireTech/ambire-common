/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable import/no-cycle */
// @ts-nocheck

import { Interface } from 'ethers/lib/utils'
import { token } from '../humanReadableTransactions'

const GMX = (humanizerInfo) => {
  const orderHandler = new Interface(humanizerInfo.abis.GMXOrderHandler)

  return {
    [orderHandler.getSighash('executeOrder')]: (txn, network, { extended }) => {
      // oracleParams
      /*
      struct SetPricesParams {
          uint256 signerInfo;
          address[] tokens;
          uint256[] compactedMinOracleBlockNumbers;
          uint256[] compactedMaxOracleBlockNumbers;
          uint256[] compactedOracleTimestamps;
          uint256[] compactedDecimals;
          uint256[] compactedMinPrices;
          uint256[] compactedMinPricesIndexes;
          uint256[] compactedMaxPrices;
          uint256[] compactedMaxPricesIndexes;
          bytes[] signatures;
          address[] priceFeedTokens;
          address[] realtimeFeedTokens;
          bytes[] realtimeFeedData;
      }
      */
      const { key, oracleParams } = orderHandler.parseTransaction(txn).args
      const tokens = oracleParams.realtimeFeedTokens
      const data = oracleParams.realtimeFeedData
      if (extended)
        return [
          [
            'Interact with GMX position',
            'from',
            {
              type: 'token',
              ...(token(humanizerInfo, tokens[tokens.length - 2], -1, true) as object)
            },
            'to',
            { type: 'token', ...(token(humanizerInfo, tokens[0], -1, true) as object) }
          ]
        ]
      return [
        `Open GMX position from ${token(humanizerInfo, tokens[tokens.length - 1], -1)} to ${token(
          humanizerInfo,
          tokens[0],
          -1
        )}`
      ]
    }
  }
}

export default GMX