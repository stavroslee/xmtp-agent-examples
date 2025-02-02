# XMTP Agent Examples

This repository contains examples of agents that use the XMTP protocol.

#### Why XMTP?

- **End-to-end & compliant**: Data is encrypted in transit and at rest, meeting strict security and regulatory standards.
- **Open-source & trustless**: Built on top of the [MLS](https://messaginglayersecurity.rocks/) protocol, it replaces trust in centralized certificate authorities with cryptographic proofs.
- **Privacy & metadata protection**: Offers anonymous or pseudonymous usage with no tracking of sender routes, IPs, or device and message timestamps.
- **Decentralized**: Operates on a peer-to-peer network, eliminating single points of failure.
- **Multi-tenant**: Allows multi-agent multi-human confidential communication over MLS group chats.

> See [FAQ](https://docs.xmtp.org/intro/faq) for more detailed information.

## Environment variables

To run your XMTP agent, you must create a `.env` file with the following variables:

```bash
WALLET_KEY= # the private key of the wallet
ENCRYPTION_KEY= # encryption key for the local database
ALCHEMY_API_KEY= # your Alchemy API key for blockchain monitoring
```

You can generate random keys with the following command:

```bash
yarn gen:keys
```

> [!WARNING]
> Running the `gen:keys` script will overwrite the existing `.env` file.

## Examples

- [gm](/examples/gm/): A multi-purpose agent that supports:
  - Group chat management
  - Update group metadata
  - remove yourself out of a group
  - Following users and get messages when they send a transaction
  - requesting a side channel be set up with expiring messages
- [gpt](/examples/gpt/): An example using GPT API's to answer messages.

> See all the available [examples](/examples/).

## Web inbox

Interact with the XMTP protocol using [xmtp.chat](https://xmtp.chat), the official web inbox for developers.

![](/media/chat.png)

> [!WARNING]
> This React app isn't a complete solution. For example, the list of conversations doesn't update when new messages arrive in existing conversations.
