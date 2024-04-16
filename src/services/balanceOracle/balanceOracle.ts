// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import oracle from 'adex-protocol-eth/abi/RemainingBalancesOracle.json'
import { ethers } from 'ethers'

import { NetworkId } from '../../constants/networks'
// eslint-disable-next-line import/no-cycle
import { Token, TokenWithIsHiddenFlag } from '../../hooks/usePortfolio'
import { getProvider } from '../provider'

const { Interface, AbiCoder, formatUnits, hexlify, isAddress } = ethers.utils
const RemainingBalancesOracle = new Interface(oracle)
const SPOOFER = '0x0000000000000000000000000000000000000001'
const remainingBalancesOracleAddr = '0xF1628de74193Dde3Eed716aB0Ef31Ca2b6347eB1'
const SPOOF_SIGTYPE = '03'

// Signature of Error(string)
const ERROR_SIG = '0x08c379a0'
// Signature of Panic(uint256)
const PANIC_SIG = '0x4e487b71'

function isErr(hex: string) {
  return hex.startsWith(ERROR_SIG) || hex.startsWith(PANIC_SIG)
}

function hex2a(hexx) {
  const hex = hexx.toString()
  let str = ''
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16))
  }
  return str
}

// ToDo check for missing data and double check for incompleted returns
async function call({
  walletAddr,
  tokens,
  network,
  pendingTransactions,
  selectedAccount,
  state
}: {
  walletAddr: string
  tokens: Token[]
  network: NetworkId
  pendingTransactions: []
  selectedAccount: {}
  state: string
}) {
  if (!isAddress(walletAddr))
    return { success: false, data: walletAddr, message: 'Wallet address is not valide eth address' }
  const provider = getProvider(network)
  const coder = new AbiCoder()
  const signer = selectedAccount.signer?.address || selectedAccount.signer?.quickAccManager

  // 1rst state - latest
  // 2nd state - pending
  // 3rd state - unconfirmed with not signed transactions
  // In both last states we need to pass block tag = pending
  const blockTag = state === 'latest' ? 'latest' : 'pending'

  const bytecode =
    blockTag === 'pending' && Object.keys(selectedAccount).length !== 0
      ? selectedAccount?.bytecode
      : '0x6080604052348015600f57600080fd5b50604880601d6000396000f3fe6080604052348015600f57600080fd5b5000fea2646970667358221220face6a0e4f251ee8ded32eb829598230ad218691166fa0a46bc85583c202c60c64736f6c634300080a0033'
  const spoofSig =
    blockTag === 'pending' && signer
      ? coder.encode(['address'], [signer]) + SPOOF_SIGTYPE
      : '0x000000000000000000000000000000000000000000000000000000000000000000'

  const args = [
    // identityFactoryAddr
    '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    // bytecode dummy.sol
    bytecode,
    // salt
    '0x0000000000000000000000000000000000000000000000000000000000000001',
    // txns
    pendingTransactions?.length
      ? pendingTransactions
      : [
          [
            '0x0000000000000000000000000000000000000000',
            '0x0',
            '0x0000000000000000000000000000000000000000'
          ]
        ],
    // signature
    spoofSig,
    // identity
    walletAddr,
    // tokens
    tokens.map((x) => x.address)
  ]
  const txParams = {
    from: SPOOFER,
    to: remainingBalancesOracleAddr,
    data: RemainingBalancesOracle.encodeFunctionData('getRemainingBalances', args)
  }
  const callResult = await provider.call(txParams, blockTag)
  if (isErr(callResult)) {
    throw new Error(`---${hex2a(callResult)}---`)
  }
  const balances = coder.decode(['uint[]'], callResult)[0]
  const result = tokens.map((x, i) => ({
    ...x,
    balanceRaw: balances[i].toString(),
    balance: parseFloat(formatUnits(balances[i], x.decimals)).toFixed(10),
    balanceOracleUpdate: new Date().valueOf()
  }))
  return { success: true, data: result }
}

async function getTokenListBalance({
  walletAddr,
  tokens,
  network,
  updateBalance,
  pendingTransactions,
  selectedAccount,
  state
}: {
  walletAddr: string
  tokens: TokenWithIsHiddenFlag[]
  network: NetworkId
  updateBalance: (token: Token | {}) => any
  pendingTransactions: []
  selectedAccount: {}
  state: string
}) {
  const result = await call({
    walletAddr,
    tokens,
    network,
    pendingTransactions,
    selectedAccount,
    state
  })
  if (result.success) {
    const newBalance = tokens.map((t) => {
      // @ts-ignore `result.data` is string only when `result.success` is `false`
      // So `result.data.filter` should always work just fine in this scope.
      const newTokenBalance = result.data.filter((r: Token) => r.address === t.address)[0]

      return newTokenBalance
        ? {
            type: 'token',
            ...t,
            ...newTokenBalance,
            balance: Number(newTokenBalance.balance),
            balanceRaw: newTokenBalance.balanceRaw,
            updateAt: new Date().toString(),
            balanceUSD: Number(
              // @ts-ignore not sure why a TS warn happens
              parseFloat(t.price * newTokenBalance.balance || 0).toFixed(2)
            ),
            // @ts-ignore not sure why a TS warn happens
            price: t.price
          }
        : {
            type: 'token',
            ...t
          }
    })
    if (updateBalance && typeof updateBalance === 'function') updateBalance(newBalance)
    return newBalance
  }
  return tokens
}

// TODO: Fill in missing types
async function getErrMsg(provider: any, txParams: any, _blockTag: any) {
  // .call always returisErrns a hex string with ethers
  try {
    // uncomment if you need HEVM debugging
    // console.log(`hevm exec --caller ${txParams.from} --address ${txParams.to} --calldata ${txParams.data} --gas 1000000 --debug --rpc ${provider.connection.rpc} ${!isNaN(_blockTag) && _blockTag ? '--block '+_blockTag : ''}`)
    const returnData = await provider.call(txParams, _blockTag)
    if (returnData.startsWith(PANIC_SIG)) return returnData.slice(10)
    return returnData.startsWith(ERROR_SIG)
      ? new AbiCoder().decode(['string'], `0x${returnData.slice(10)}`)[0]
      : returnData
  } catch (e: any) {
    // weird infura case
    if (e.code === 'UNPREDICTABLE_GAS_LIMIT' && e.error) return e.error.message.slice(20)
    if (e.code === 'CALL_EXCEPTION')
      return 'no error string, possibly insufficient amount or wrong SmartWallet sig'
    if (e.code === 'INVALID_ARGUMENT') return `unable to deserialize: ${hexlify(e.value)}`
    throw e
  }
}

function checkTokenList(list: Token[]) {
  return list.filter((t) => {
    return isAddress(t.address)
  })
}

const removeDuplicatedAssets = (_tokens: Token[]) => {
  let tokens = _tokens
  const lookup =
    tokens?.length &&
    tokens.reduce((a: Token, e: Token) => {
      a[e.address.toLowerCase()] = ++a[e.address.toLowerCase()] || 0
      return a
    }, {})

  // filters by non duplicated objects or takes the one of dup but with a price or price greater than 0
  tokens = tokens?.length
    ? tokens
        .filter(
          (e) =>
            !lookup[e.address.toLowerCase()] ||
            (lookup[e.address.toLowerCase()] && e.price !== undefined) ||
            (lookup[e.address.toLowerCase()] && e.price)
        )
        // Actually remove if duplicated tokens are passed.
        .filter(function ({ address }) {
          return !this.has(address.toLowerCase()) && this.add(address.toLowerCase())
        }, new Set())
    : []

  return tokens
}

export { call, getErrMsg, checkTokenList, getTokenListBalance, removeDuplicatedAssets }
