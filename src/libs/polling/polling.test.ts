import fetch from 'node-fetch'

import { Polling } from './polling'
import { requestMagicLink } from '../magicLink/magicLink'
import { EmailVault } from '../emailVault/emailVault'
import { EmailVaultData } from '../../interfaces/emailVault'

const email = 'emil@ambire.com'
const relayerUrl = 'http://localhost:1934'

async function test() {
  const polling = new Polling()
  const ev = new EmailVault(fetch, relayerUrl)
  const magicLinkKey = await requestMagicLink(email, relayerUrl, fetch)

  polling.onUpdate(() => {
    if (polling.state.isError) {
      console.log('[onUpdate] last status:', polling.state.error.output.res.status)
    }
  })
  const result: EmailVaultData | null = await polling.exec(ev.getEmailVaultInfo.bind(ev), [
    email,
    magicLinkKey.key
  ])

  console.log({ result })
}

test()
