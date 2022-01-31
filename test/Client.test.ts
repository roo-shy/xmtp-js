import { PrivateKeyBundle } from '../src/crypto'
import assert from 'assert'
import { waitFor, newWallet } from './helpers'
import { promiseWithTimeout, sleep } from '../src/utils'
import Client from '../src/Client'

const newLocalDockerClient = (): Promise<Client> =>
  Client.create({
    bootstrapAddrs: [
      '/ip4/127.0.0.1/tcp/9001/ws/p2p/16Uiu2HAmNCxLZCkXNbpVPBpSSnHj9iq4HZQj7fxRzw2kj1kKSHHA',
    ],
  })

const newTestnetClient = (): Promise<Client> =>
  Client.create({
    bootstrapAddrs: [
      '/dns4/bootstrap-node-0.testnet.xmtp.network/tcp/8443/wss/p2p/16Uiu2HAm888gVYpr4cZQ4qhEendQW6oYEhG8n6fnqw1jVW3Prdc6',
    ],
  })

describe('Client', () => {
  const tests = [
    {
      name: 'testnet',
      newClient: newTestnetClient,
    },
    {
      name: 'local docker node',
      newClient: newLocalDockerClient,
    },
  ]
  tests.forEach((testCase) => {
    describe(testCase.name, () => {
      let client: Client
      beforeAll(async () => {
        client = await testCase.newClient()
      })
      afterAll(async () => {
        if (client) await client.close()
      })

      it('create', async () => {
        assert.ok(client.waku)
        assert(Array.from(client.waku.relay.getPeers()).length === 1)
      })

      it('publish and get user contact', async () => {
        const registered = await PrivateKeyBundle.generate(newWallet())
        await client.publicUserContact(registered.getUserContact())
        await sleep(10)
        const received = await client.getUserContact(
          registered.identityKey.publicKey.walletSignatureAddress()
        )
        assert.deepEqual(registered.getUserContact(), received)
      })

      it('stream and send messages', async () => {
        const sender = await PrivateKeyBundle.generate(newWallet())
        const recipient = await PrivateKeyBundle.generate(newWallet())
        await client.publicUserContact(recipient.getUserContact())
        const stream = client.streamMessages(
          sender.identityKey.publicKey.walletSignatureAddress(),
          recipient
        )

        await client.sendMessage(sender, recipient.getUserContact(), 'hi')
        await client.sendMessage(sender, recipient.getUserContact(), 'hello')

        let msg = await stream.next()
        assert.equal(msg.decrypted, 'hi')

        msg = await stream.next()
        assert.equal(msg.decrypted, 'hello')

        let timeout = false
        try {
          await promiseWithTimeout<void>(
            5,
            async () => {
              await stream.next()
            },
            'timeout'
          )
        } catch (err) {
          timeout = err instanceof Error && (err as Error).message === 'timeout'
        }
        assert.ok(timeout)
      })
      it('listMessages', async () => {
        const recipient = await PrivateKeyBundle.generate(newWallet())

        const sender = await PrivateKeyBundle.generate(newWallet())
        await client.sendMessage(sender, recipient.getUserContact(), 'hi')

        const messages = await waitFor(
          async () => {
            const messages = await client.listMessages(
              sender.identityKey.publicKey.walletSignatureAddress(),
              recipient
            )
            if (!messages.length) throw new Error('no messages')
            return messages
          },
          5000,
          100
        )
        assert.ok(messages.length === 1)
        assert.equal(messages[0].decrypted, 'hi')
      })
    })
  })
})
