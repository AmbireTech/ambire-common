import path from 'path'
import parseEmail from '../../src/libs/dkim/parseEmail'
import fs from 'fs'
import { promisify } from 'util'
const readFile = promisify(fs.readFile)
const emailsPath = path.join(__dirname, 'emails')

describe('DKIM', function () {
  it('successfully parses a gmail email', async function () {
    const gmail = await readFile(path.join(emailsPath, 'youtube.eml'), {
        encoding: 'ascii'
    })
    const parsedContents = await parseEmail(gmail)
    console.log(parsedContents)
  })
})
