import { ContentTypeGroupUpdated } from "@xmtp/content-type-group-updated";
import { ContentTypeText } from "@xmtp/content-type-text";
import {
  Client,
  type Conversation,
  type CreateGroupOptions,
  type XmtpEnv,
} from "@xmtp/node-sdk";
import { createSigner, getEncryptionKeyFromHex, loadEnv } from "@/helpers";
import { ChainListener } from "../../src/chainListener";

// Load environment variables from .env.local if it exists, otherwise from .env
loadEnv({ path: ".env.local" });
loadEnv();

const { WALLET_KEY, ENCRYPTION_KEY, ALCHEMY_API_KEY, POLL_INTERVAL_SECONDS } =
  process.env;

if (!WALLET_KEY) {
  throw new Error("WALLET_KEY must be set");
}

if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY must be set");
}

if (!ALCHEMY_API_KEY) {
  throw new Error("ALCHEMY_API_KEY must be set");
}

// Validate poll interval
const DEFAULT_POLL_INTERVAL = 30; // seconds
const pollIntervalSeconds = POLL_INTERVAL_SECONDS
  ? parseInt(POLL_INTERVAL_SECONDS, 10)
  : DEFAULT_POLL_INTERVAL;

if (
  isNaN(pollIntervalSeconds) ||
  pollIntervalSeconds < 10 ||
  pollIntervalSeconds > 5000
) {
  console.log(
    `Invalid POLL_INTERVAL_SECONDS (${POLL_INTERVAL_SECONDS}), using default of ${DEFAULT_POLL_INTERVAL} seconds`,
  );
}

const signer = createSigner(WALLET_KEY);
const encryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);

const env: XmtpEnv = "production";

// Add these type definitions and state management
type ConversationState = {
  approvedMembers: Set<string>;
  storedMessage?: string;
  welcomeMessage?: string;
  shouldSendWelcome: boolean;
  following: Set<string>; // Store 0x addresses of followed accounts
  chainListener?: ChainListener;
};

const conversationStates = new Map<string, ConversationState>();

// Helper functions
async function initializeConversationState(
  client: Client,
  conversation: Conversation,
) {
  const members = await conversation.members();
  const memberIds = members.map((m) => m.inboxId);
  conversationStates.set(conversation.id, {
    approvedMembers: new Set(memberIds),
    storedMessage: undefined,
    welcomeMessage: undefined,
    shouldSendWelcome: false,
    following: new Set(),
  });
}

async function updateGroupMetadata(client: Client, conversation: Conversation) {
  // Check if bot has admin permissions for metadata updates
  if (!conversation.isAdmin(client.inboxId)) {
    await conversation.send(
      "Sorry, I don't have admin permissions to update group metadata.",
    );
    return;
  }

  const now = new Date();
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });
  const timestamp = now.toISOString();

  const members = await conversation.members();
  const memberCount = members.length;

  await conversation.updateName(`${dayName} ${timestamp}`);
  await conversation.updateDescription(
    `${memberCount} having a fun chat ${timestamp}`,
  );
}

async function handleKickAndReaddMember(
  client: Client,
  conversation: Conversation,
  senderInboxId: string,
) {
  try {
    // Check if bot has admin permissions
    console.log("checking if bot has admin permissions");
    console.log(client.inboxId);
    if (!conversation.isAdmin(client.inboxId)) {
      await conversation.send(
        "Sorry, I don't have admin permissions to manage members.",
      );
      return;
    }

    await conversation.removeMembersByInboxId([senderInboxId]);
    console.log(`Removed member ${senderInboxId}`);
  } catch (error) {
    console.error("Error in kick and readd:", error);
  }
}

// Add welcome message helper
async function sendWelcomeMessage(
  client: Client,
  conversation: Conversation,
  newMemberInboxId: string,
) {
  const state = conversationStates.get(conversation.id);
  if (!state || !state.shouldSendWelcome || !state.welcomeMessage) {
    return;
  }

  try {
    const members = await conversation.members();
    const newMember = members.find((m) => m.inboxId === newMemberInboxId);
    if (!newMember || !newMember.accountAddresses.length) {
      console.log("Could not find new member's address for welcome message");
      return;
    }

    // Create a DM to send the welcome message
    const dmConversation = await client.conversations.newDm(
      newMember.accountAddresses[0],
    );
    await dmConversation.send(
      `Welcome to ${conversation.name}!\n\n${state.welcomeMessage}`,
    );
  } catch (error) {
    console.error("Error sending welcome message:", error);
  }
}

// Add introduction message helper
async function sendIntroductionMessage(
  client: Client,
  conversation: Conversation,
) {
  const introText =
    "👋 Hello! I'm a helpful bot that can assist with various tasks in this group.\n\n" +
    "Here are some key things I can help with:\n\n" +
    "🔔 **Transaction Alerts**\n" +
    "- Use `/addFollow 0x...` to get notified when an address sends transactions\n" +
    "- Use `/startWatching` to begin monitoring (supports ETH_MAINNET, BASE_MAINNET, BASE_SEPOLIA)\n\n" +
    "👥 **Group Management**\n" +
    "- Use `/setWelcomeMessage` to set up automatic welcome DMs for new members\n" +
    "- Use `/setSendWelcome 1` to enable welcome messages\n" +
    "- Use `/kickMe` to remove yourself from the group\n\n" +
    "📌 **Message Storage**\n" +
    "- Use `/storeMessage` to save important information\n" +
    "- Use `/loadMessage` to recall the stored message\n\n" +
    "Type `/help` to see all available commands!\n\n" +
    "I'm here to help make this group more useful and fun! 🤖✨";

  await conversation.send(introText);
}

// Add polling helper
async function pollForNewConversations(client: Client) {
  try {
    // Sync to get latest conversations
    await client.conversations.sync();
    const currentConversations = client.conversations.list();
    console.log(
      `Polling for new convos. Found ${currentConversations.length} conversations`,
    );

    for (const conversation of currentConversations) {
      // Skip if we already know about this conversation
      if (conversationStates.has(conversation.id)) {
        continue;
      }

      // Check if we're a member
      const members = await conversation.members();
      const isInGroup = members.some((m) => m.inboxId === client.inboxId);
      const isSuperAdmin = conversation.isSuperAdmin(client.inboxId);

      if (isInGroup) {
        console.log("Found new conversation we're in:", conversation.id);
        await initializeConversationState(client, conversation);
        if (isSuperAdmin) {
          console.log(
            "we're a super admin, skipping introduction since I created this chat",
          );
        } else {
          await sendIntroductionMessage(client, conversation);
        }
      }
    }
  } catch (error) {
    console.error("Error polling for new conversations:", error);
  }
}

async function main() {
  console.log(`Creating client on the '${env}' network...`);
  const client = await Client.create(signer, encryptionKey, { env });

  console.log("Syncing conversations...");
  await client.conversations.sync();

  const conversations = client.conversations.list();
  console.log(`i have ${conversations.length} conversations`);

  // Initialize state for existing conversations
  for (const conversation of conversations) {
    if (!conversationStates.has(conversation.id)) {
      await initializeConversationState(client, conversation);
    }
  }

  console.log(
    `Agent initialized on ${client.accountAddress}\nSend a message on http://xmtp.chat/dm/${client.accountAddress}`,
  );

  // Start polling for new conversations
  const pollIntervalMs =
    Math.max(
      Math.min(
        isNaN(pollIntervalSeconds)
          ? DEFAULT_POLL_INTERVAL
          : pollIntervalSeconds,
        5000,
      ),
      10,
    ) * 1000; // Convert to milliseconds

  console.log(
    `Starting conversation polling with interval of ${pollIntervalMs / 1000} seconds`,
  );

  setInterval(() => {
    pollForNewConversations(client).catch((error: unknown) => {
      console.error("Error in polling interval:", error);
    });
  }, pollIntervalMs);

  console.log("Waiting for messages...");
  const stream = client.conversations.streamAllMessages();

  for await (const message of await stream) {
    if (!message || !message.contentType) {
      console.log("Invalid message, skipping", message);
      continue;
    }

    // Ignore own messages
    if (message.senderInboxId === client.inboxId) {
      continue;
    }

    if (ContentTypeGroupUpdated.sameAs(message.contentType)) {
      console.log("group update to group", message.conversationId);

      const conversation = client.conversations.getConversationById(
        message.conversationId,
      );

      if (!conversation) {
        console.log("Unable to find conversation for group update, skipping");
        continue;
      }

      // Check if this is a removal update
      const members = await conversation.members();
      const isStillInGroup = members.some((m) => m.inboxId === client.inboxId);

      if (!isStillInGroup && conversationStates.has(conversation.id)) {
        console.log("We were removed from the group, cleaning up state");
        conversationStates.delete(conversation.id);
      }
      continue;
    }

    // Ignore non-text messages after this point
    if (!ContentTypeText.sameAs(message.contentType)) {
      console.log("unsupported content type", message);
      continue;
    }

    const conversation = client.conversations.getConversationById(
      message.conversationId,
    );

    if (!conversation) {
      console.log("Unable to find conversation, skipping");
      continue;
    }

    // Initialize state if it doesn't exist
    if (!conversationStates.has(conversation.id)) {
      await initializeConversationState(client, conversation);
    }

    const state = conversationStates.get(conversation.id);
    if (!state) {
      console.log("Missing conversation state, skipping");
      continue;
    }

    const content = message.content as string;
    const contentLower = content.toLowerCase();

    // Handle different commands
    if (contentLower === "/help") {
      const helpText =
        "**XMTP Bot Commands**\n\n" +
        "\nAvailable commands:\n\n" +
        "/help                    - Show this help message\n" +
        "/createDm                - Create a private DM chat with the bot\n" +
        "/createSideChannel       - Create a private group chat with 5 minute message expiry\n" +
        "/kickMe                  - Remove yourself from the conversation\n" +
        "/updateMeta              - Update the group metadata with current time and member count\n" +
        "/storeMessage [msg]      - Store a message for later\n" +
        "/loadMessage             - Display the previously stored message\n" +
        "/setWelcomeMessage [msg] - Set the welcome message for new members (empty to clear)\n" +
        "/setSendWelcome [1|0]    - Enable/disable sending welcome messages\n" +
        "/refreshMembers          - Remove any members that are not in the approved list\n" +
        "/listMembers             - Show the list of approved members\n" +
        "/addMember [id]          - Add a member to the approved list\n" +
        "/removeMember [id]       - Remove a member from the conversation\n" +
        "/addFollow [0xAddress]   - Add an address to your follow list\n" +
        "/removeFollow [0xAddress]- Remove an address from your follow list\n" +
        "/listFollows             - Show all addresses you're following\n" +
        "/startWatching [network] - Start watching transactions (network: ETH_MAINNET, BASE_MAINNET, BASE_SEPOLIA)\n" +
        "/stopWatching           - Stop watching transactions\n" +
        "\n\n" +
        "💡 This bot is based on https://github.com/ephemeraHQ/xmtp-agent-examples - start building your own!";
      await conversation.send(helpText);
      continue;
    }

    if (contentLower === "/createsidechannel") {
      try {
        // Create a new group conversation with 1-hour message expiry
        const members = await conversation.members();
        const sender = members.find((m) => m.inboxId === message.senderInboxId);
        if (!sender || !sender.accountAddresses.length) {
          await conversation.send(
            "Sorry, I couldn't find your wallet address to create the channel.",
          );
          continue;
        }

        const FIVE_MINUTES_MS = 5 * 60 * 1000;
        const options: CreateGroupOptions = {
          groupName: `Ephemeral Chat - ${new Date().toLocaleTimeString()}`,
          groupDescription: "Messages in this chat expire after 5 minutes",
          permissions: 0,
          messageExpirationMs: FIVE_MINUTES_MS,
        };

        const sideChannel = await client.conversations.newGroup(
          [sender.accountAddresses[0]],
          options,
        );

        await sideChannel.send(
          "👋 Welcome to the ephemeral chat! Messages here will expire after 1 hour.",
        );

        // Send confirmation in the original chat
        await conversation.send(
          "I've created an ephemeral chat channel for you. Check your groups!",
        );
      } catch (error) {
        console.error("Error creating side channel:", error);
        await conversation.send(
          "Sorry, I encountered an error trying to create the ephemeral chat.",
        );
      }
      continue;
    }

    if (contentLower === "/createdm") {
      try {
        console.log("handling /dm");
        const newOnly = true;

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!newOnly) {
          console.log("checking for existing dm");
          // Get the existing DM or create a new one
          const existingDm = client.conversations.getDmByInboxId(
            message.senderInboxId,
          );

          if (existingDm) {
            await conversation.send(
              "We already have a DM chat! Check your DMs, I'll send you a message there.",
            );
            await existingDm.send("👋 Here I am! You can chat with me here.");
            continue;
          }
        }

        // Create a new DM conversation
        const members = await conversation.members();
        const sender = members.find((m) => m.inboxId === message.senderInboxId);
        if (!sender || !sender.accountAddresses.length) {
          await conversation.send(
            "Sorry, I couldn't find your wallet address to create a DM.",
          );
          continue;
        }

        const createDm = false;

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (createDm) {
          console.log("creating new dm");
          // Use the first account address associated with the sender
          const dmConversation = await client.conversations.newDm(
            sender.accountAddresses[0],
          );
          await dmConversation.send(
            "👋 Hello! This is a private DM chat with me. Feel free to send me messages here!",
          );

          // Send confirmation in the group chat
          await conversation.send(
            "I've created a private DM chat with you. Check your DMs!",
          );
        } else {
          console.log("creating new group");
          const options: CreateGroupOptions = {
            groupName: `New Group Chat - ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
            groupDescription: "This is a new group chat with me.",
            permissions: 0,
          };
          const dmConversation = await client.conversations.newGroup(
            [sender.accountAddresses[0]],
            options,
          );
          await dmConversation.send(
            "👋 Hello! This is a new group chat with me. Feel free to send me messages here!",
          );
        }
      } catch (error) {
        console.error("Error creating DM:", error);
        await conversation.send(
          "Sorry, I encountered an error trying to create a DM chat.",
        );
      }
      console.log("done handling /dm");
      continue;
    }

    if (contentLower === "/kickme") {
      await handleKickAndReaddMember(
        client,
        conversation,
        message.senderInboxId,
      );
      continue;
    }

    if (contentLower.startsWith("/removemember ")) {
      const xid = content.split(" ")[1];
      if (xid) {
        // Check if bot has admin permissions
        if (!conversation.isAdmin(client.inboxId)) {
          await conversation.send(
            "Sorry, I don't have admin permissions to remove members.",
          );
          continue;
        }
        // Check if sender is admin
        if (!conversation.isAdmin(message.senderInboxId)) {
          await conversation.send("Sorry, only admins can remove members.");
          continue;
        }

        state.approvedMembers.delete(xid);
        try {
          await conversation.removeMembersByInboxId([xid]);
          await conversation.send(
            `Removed ${xid} from the conversation and approved members list`,
          );
        } catch (error) {
          console.error("Error removing member:", error);
          await conversation.send(
            `Failed to remove ${xid} from conversation, but removed from approved list`,
          );
        }
      }
      continue;
    }

    if (contentLower.startsWith("/addmember ")) {
      const xid = content.split(" ")[1];
      if (xid) {
        // Check if bot has admin permissions
        if (!conversation.isAdmin(client.inboxId)) {
          await conversation.send(
            "Sorry, I don't have admin permissions to add members.",
          );
          continue;
        }
        // Check if sender is admin
        if (!conversation.isAdmin(message.senderInboxId)) {
          await conversation.send("Sorry, only admins can add members.");
          continue;
        }

        state.approvedMembers.add(xid);
        await conversation.send(`Added ${xid} to approved members list`);

        // Send welcome message if enabled
        await sendWelcomeMessage(client, conversation, xid);
      }
      continue;
    }

    // Add follow commands
    if (contentLower.startsWith("/addfollow ")) {
      const address = content.split(" ")[1]?.toLowerCase();
      if (!address.startsWith("0x")) {
        await conversation.send(
          "Please provide a valid ethereum address (starting with 0x)",
        );
        continue;
      }

      const isFirstAddress = state.following.size === 0;
      state.following.add(address);

      console.log("following ", address);

      // Update chain listener if active
      if (state.chainListener) {
        await state.chainListener.updateFollowedAddresses(state.following);
      } else if (isFirstAddress) {
        // Automatically start watching BASE_SEPOLIA for the first address
        state.chainListener = new ChainListener(
          ALCHEMY_API_KEY as string,
          client,
          "BASE_SEPOLIA",
        );
        state.chainListener.setNotificationConversation(conversation);
        await state.chainListener.updateFollowedAddresses(state.following);
        await state.chainListener.startListening();
        await conversation.send(
          `Started watching for transactions from ${address} on BASE_SEPOLIA!`,
        );
      }

      await conversation.send(`Added ${address} to your follow list`);
      continue;
    }

    if (contentLower.startsWith("/removefollow ")) {
      const address = content.split(" ")[1]?.toLowerCase();
      if (!address.startsWith("0x")) {
        await conversation.send(
          "Please provide a valid ethereum address (starting with 0x)",
        );
        continue;
      }
      if (state.following.delete(address)) {
        // Update chain listener if active
        if (state.chainListener) {
          await state.chainListener.updateFollowedAddresses(state.following);
        }
        await conversation.send(`Removed ${address} from your follow list`);
      } else {
        await conversation.send(
          `Address ${address} was not in your follow list`,
        );
      }
      continue;
    }

    if (contentLower === "/listfollows") {
      if (state.following.size === 0) {
        await conversation.send("You're not following any addresses yet");
      } else {
        const followList = Array.from(state.following).join("\n");
        await conversation.send(`Following these addresses:\n${followList}`);
      }
      continue;
    }

    if (contentLower === "/updatemeta") {
      await updateGroupMetadata(client, conversation);
      await conversation.send("Updated group metadata!");
      continue;
    }

    if (contentLower.startsWith("/setwelcomemessage ")) {
      const welcomeMessage = content.slice("/setWelcomeMessage ".length).trim();
      state.welcomeMessage = welcomeMessage || undefined;

      if (welcomeMessage) {
        await conversation.send("Welcome message set!");
        if (!state.shouldSendWelcome) {
          await conversation.send(
            "Note: Welcome messages are currently disabled. Use /setSendWelcome 1 to enable them.",
          );
        }
      } else {
        await conversation.send("Welcome message cleared.");
      }
      continue;
    }

    if (contentLower.startsWith("/setsendwelcome ")) {
      const value = content.split(" ")[1];
      const shouldSend = value === "1";
      state.shouldSendWelcome = shouldSend;

      if (shouldSend && !state.welcomeMessage) {
        await conversation.send(
          "Welcome messages enabled, but no welcome message is set. Use /setWelcomeMessage to set one.",
        );
      } else {
        await conversation.send(
          `Welcome messages ${shouldSend ? "enabled" : "disabled"}.`,
        );
      }
      continue;
    }

    if (contentLower === "/refreshmembers") {
      // Check if bot has admin permissions
      if (!conversation.isAdmin(client.inboxId)) {
        await conversation.send(
          "Sorry, I don't have admin permissions to manage members.",
        );
        continue;
      }
      // Check if sender is admin
      if (!conversation.isAdmin(message.senderInboxId)) {
        await conversation.send("Sorry, only admins can refresh members.");
        continue;
      }

      const currentMembers = await conversation.members();
      const currentMemberIds = new Set(currentMembers.map((m) => m.inboxId));

      for (const memberId of currentMemberIds) {
        if (!state.approvedMembers.has(memberId)) {
          await conversation.removeMembersByInboxId([memberId]);
          await conversation.send(`Removed unauthorized member: ${memberId}`);
        }
      }
      continue;
    }

    if (contentLower === "/listmembers") {
      const membersList = Array.from(state.approvedMembers).join("\n");
      await conversation.send(
        `Approved members: (inboxIds, not 0x addresses)\n${membersList}`,
      );
      continue;
    }

    if (contentLower.startsWith("/storemessage ")) {
      state.storedMessage = content.slice("/storeMessage ".length);
      await conversation.send("Message stored!");
      continue;
    }

    if (contentLower === "/loadmessage") {
      const response = state.storedMessage || "No message stored";
      await conversation.send(response);
      continue;
    }

    if (contentLower.startsWith("/startwatching")) {
      if (!state.following.size) {
        await conversation.send(
          "You need to add addresses to your follow list first using /addFollow",
        );
        continue;
      }

      // Parse network parameter
      const parts = content.split(" ");
      const network = (parts[1]?.toUpperCase() || "BASE_MAINNET") as
        | "ETH_MAINNET"
        | "BASE_MAINNET"
        | "BASE_SEPOLIA";

      if (!["ETH_MAINNET", "BASE_MAINNET", "BASE_SEPOLIA"].includes(network)) {
        await conversation.send(
          "Invalid network. Please use one of: ETH_MAINNET, BASE_MAINNET, BASE_SEPOLIA",
        );
        continue;
      }

      if (!state.chainListener) {
        state.chainListener = new ChainListener(
          ALCHEMY_API_KEY as string,
          client,
          network,
        );
        state.chainListener.setNotificationConversation(conversation);
      }

      await state.chainListener.updateFollowedAddresses(state.following);
      await state.chainListener.startListening();
      await conversation.send(
        `Started watching for transactions from followed addresses on ${network}!`,
      );
      continue;
    }

    if (contentLower === "/stopwatching") {
      if (state.chainListener) {
        state.chainListener.stopListening();
        state.chainListener = undefined;
        await conversation.send("Stopped watching for transactions.");
      } else {
        await conversation.send("Transaction watching was not active.");
      }
      continue;
    }

    // Default gm response if no command matched
    console.log(
      `Received unhandled message: ${content} by ${message.senderInboxId}`,
    );

    await conversation.send("sorry I didn't understand that");

    console.log("Waiting for messages...");
  }
}

main().catch(console.error);
