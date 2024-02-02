/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-useless-constructor */
/* eslint-disable max-classes-per-file */
import { describe, expect, test } from '@jest/globals'
import fetch from 'node-fetch'

import { requestMagicLink } from './magicLink'

const playstationEmail = 'playstation'
const exMagicLinkKey = 'b12239309b38294f4075463ff131ac8cfe32ef2f99fc'
const email = 'unufri+playstation@ambire.com'
const relayerUrl = 'https://staging-relayer.ambire.com'

describe('MagicLink', () => {
  test('should return key for session', async () => {
    const result = await requestMagicLink(email, relayerUrl, fetch)
    expect(result.key).not.toBe('')
  })

  test('should return invalid email', async () => {
    try {
      await requestMagicLink(playstationEmail, relayerUrl, fetch)
    } catch (e: any) {
      expect(e.message).toBe('magicLink: error getting magic link: invalid email')
    }
  })

  test('try to get key from key should return invalid email', async () => {
    try {
      await requestMagicLink(exMagicLinkKey, relayerUrl, fetch)
    } catch (e: any) {
      expect(e.message).toBe('magicLink: error getting magic link: invalid email')
    }
  })
})
