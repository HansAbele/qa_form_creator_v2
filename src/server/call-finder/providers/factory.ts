import "server-only";

import { InteractionProvider } from "@prisma/client";
import type { CallSourceAdapter } from "@/server/call-finder/providers/contracts";
import { FreePbxCallSourceAdapter, loadFreePbxAdapterConfig } from "./freepbx";
import { loadNiceCxoneAdapterConfig, NiceCxoneCallSourceAdapter } from "./nice-cxone";
import { loadNiceCxoneAccessKeyConfig, NiceCxoneAccessKeyTokenProvider } from "./nice-cxone-auth";

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

export function createFreePbxCallSourceAdapter(instanceKey: string): CallSourceAdapter {
  const adapterConfig = loadFreePbxAdapterConfig();
  if (adapterConfig.instanceKey !== instanceKey) {
    throw new Error("FreePBX source does not match the configured provider instance");
  }
  return new FreePbxCallSourceAdapter(adapterConfig);
}

export function createCallSourceAdapter(
  provider: InteractionProvider,
  instanceKey: string,
): CallSourceAdapter {
  if (provider === InteractionProvider.NICE_CXONE) {
    return createNiceCxoneCallSourceAdapter(instanceKey);
  }
  if (provider === InteractionProvider.FREEPBX) {
    return createFreePbxCallSourceAdapter(instanceKey);
  }
  throw new Error(`No call source adapter is configured for ${provider}`);
}
