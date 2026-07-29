import "server-only";

import { InteractionProvider } from "@prisma/client";
import type { CallSourceAdapter } from "@/server/call-finder/providers/contracts";
import { NiceCxoneCallSourceAdapter, loadNiceCxoneAdapterConfig } from "./nice-cxone";
import { NiceCxoneAccessKeyTokenProvider, loadNiceCxoneAccessKeyConfig } from "./nice-cxone-auth";

export function createNiceCxoneCallSourceAdapter(instanceKey: string): CallSourceAdapter {
  const adapterConfig = loadNiceCxoneAdapterConfig();
  if (adapterConfig.instanceKey !== instanceKey) {
    throw new Error("NICE CXone source does not match the configured provider instance");
  }

  return new NiceCxoneCallSourceAdapter(
    adapterConfig,
    new NiceCxoneAccessKeyTokenProvider(loadNiceCxoneAccessKeyConfig()),
  );
}

export function createCallSourceAdapter(
  provider: InteractionProvider,
  instanceKey: string,
): CallSourceAdapter {
  if (provider === InteractionProvider.NICE_CXONE) {
    return createNiceCxoneCallSourceAdapter(instanceKey);
  }
  throw new Error(`No call source adapter is configured for ${provider}`);
}
