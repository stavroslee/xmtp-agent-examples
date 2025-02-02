/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import { getRandomValues } from "node:crypto";
import { config, type DotenvConfigOptions } from "dotenv";
import { fromString, toString } from "uint8arrays";
import { toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Load environment variables from .env.local if it exists, otherwise from .env
// eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents
export const loadEnv = (options?: DotenvConfigOptions | undefined) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
    const result = config(options);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (result.error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      console.warn(`Warning: ${options?.path || ".env"} not found`);
    }
  } catch (error) {
    console.warn(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      `Warning: Error loading ${(options?.path as string) || ".env"}:`,
      error,
    );
  }
};

export const createSigner = (privateKey: `0x${string}`) => {
  const account = privateKeyToAccount(privateKey);
  return {
    getAddress: () => account.address,
    signMessage: async (message: string) => {
      const signature = await account.signMessage({
        message,
      });
      return toBytes(signature);
    },
  };
};

export const generateEncryptionKeyHex = () => {
  const uint8Array = getRandomValues(new Uint8Array(32));
  return toString(uint8Array, "hex");
};

export const getEncryptionKeyFromHex = (hex: string) => {
  return fromString(hex, "hex");
};
