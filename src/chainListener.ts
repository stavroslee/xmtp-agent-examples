import type { Client, Conversation } from "@xmtp/node-sdk";
import { Alchemy, AlchemySubscription, type Network } from "alchemy-sdk";
import { ethers } from "ethers";

// Network configuration
type SupportedNetwork = "ETH_MAINNET" | "BASE_MAINNET" | "BASE_SEPOLIA";

interface NetworkConfig {
  name: SupportedNetwork;
  chainId: number;
  explorerUrl: string;
  alchemyNetwork: Network;
}

const NETWORK_CONFIGS: Record<SupportedNetwork, NetworkConfig> = {
  ETH_MAINNET: {
    name: "ETH_MAINNET",
    chainId: 1,
    explorerUrl: "https://etherscan.io",
    alchemyNetwork: "eth-mainnet" as Network,
  },
  BASE_MAINNET: {
    name: "BASE_MAINNET",
    chainId: 8453,
    explorerUrl: "https://basescan.org",
    alchemyNetwork: "base-mainnet" as Network,
  },
  BASE_SEPOLIA: {
    name: "BASE_SEPOLIA",
    chainId: 84531,
    explorerUrl: "https://sepolia.basescan.org",
    alchemyNetwork: "base-sepolia" as Network,
  },
};

export class ChainListener {
  private alchemy: Alchemy;

  private provider: ethers.providers.JsonRpcProvider | null;
  private followedAddresses: Set<string>;
  private notificationConversation: Conversation | null;
  private client: Client;
  private network: NetworkConfig;
  private isListening: boolean;

  constructor(
    alchemyApiKey: string,
    client: Client,
    network: SupportedNetwork = "BASE_MAINNET",
  ) {
    const settings = {
      apiKey: alchemyApiKey,
      network: NETWORK_CONFIGS[network].alchemyNetwork,
    };

    this.alchemy = new Alchemy(settings);
    this.provider = null;
    this.followedAddresses = new Set<string>();
    this.notificationConversation = null;
    this.client = client;
    this.network = NETWORK_CONFIGS[network];
    this.isListening = false;
  }

  private async initializeProvider() {
    if (!this.provider) {
      const provider = await this.alchemy.config.getProvider();

      this.provider = new ethers.providers.JsonRpcProvider(
        provider.connection.url,
      );
    }

    return this.provider;
  }

  public setNotificationConversation(conversation: Conversation) {
    this.notificationConversation = conversation;
  }

  public async updateFollowedAddresses(addresses: Set<string>) {
    this.followedAddresses = new Set(addresses);

    // If we're already listening, restart to update the filters
    if (this.isListening) {
      this.stopListening();
      await this.startListening();
    }
  }

  private async notifyTransaction(tx: ethers.providers.TransactionResponse) {
    if (!this.notificationConversation) return;

    try {
      const ethValue = ethers.utils.formatEther(tx.value);
      if (tx.to) {
        const message =
          `🔔 Transaction detected on ${this.network.name}!\n` +
          `From: ${tx.from}\n` +
          `To: ${tx.to}\n` +
          `Value: ${ethValue} ETH\n` +
          `Transaction Hash: ${tx.hash}\n` +
          `Block Number: ${tx.blockNumber}\n` +
          `Gas Price: ${ethers.utils.formatUnits(tx.gasPrice || 0, "gwei")} Gwei\n` +
          `View on Explorer: ${this.network.explorerUrl}/tx/${tx.hash}`;

        await this.notificationConversation.send(message);
      }
    } catch (error) {
      console.error("Error sending transaction notification:", error);
    }
  }

  public async startListening() {
    if (this.isListening) return;

    try {
      await this.initializeProvider();

      // Listen for pending transactions
      const supportsPending = false;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (supportsPending) {
        this.alchemy.ws.on(
          {
            method: AlchemySubscription.PENDING_TRANSACTIONS,
            fromAddress: Array.from(this.followedAddresses),
            toAddress: Array.from(this.followedAddresses),
          },
          (tx: { hash: string }) => {
            void (async () => {
              const provider = await this.initializeProvider();
              const fullTx = await provider.getTransaction(tx.hash);
              await this.notifyTransaction(fullTx);
            })();
          },
        );
      }

      // Listen for mined transactions
      this.alchemy.ws.on(
        {
          method: AlchemySubscription.MINED_TRANSACTIONS,
          addresses: [
            { from: Array.from(this.followedAddresses)[0] },
            ...Array.from(this.followedAddresses)
              .slice(1)
              .map((addr) => ({
                from: addr,
              })),
          ],
          includeRemoved: true,
          hashesOnly: false,
        },
        (tx: { transaction: { hash: string } }) => {
          void (async () => {
            const provider = await this.initializeProvider();
            console.log("tx", tx.transaction.hash);
            const fullTx = await provider.getTransaction(tx.transaction.hash);
            await this.notifyTransaction(fullTx);
          })();
        },
      );

      this.isListening = true;
      console.log(`Started listening for transactions on ${this.network.name}`);
    } catch (error) {
      console.error("Error starting WebSocket listener:", error);
      throw error;
    }
  }

  public stopListening() {
    if (!this.isListening) return;

    try {
      // Remove all WebSocket listeners
      this.alchemy.ws.removeAllListeners();
      this.isListening = false;
      console.log(`Stopped listening for transactions on ${this.network.name}`);
    } catch (error) {
      console.error("Error stopping WebSocket listener:", error);
      throw error;
    }
  }
}
