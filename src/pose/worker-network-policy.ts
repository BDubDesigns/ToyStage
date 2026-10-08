import { restrictWorkerNetwork } from "./worker-network";

// This side-effect module must be the FIRST runtime import in each model worker.
export const blockedNetworkRequests = restrictWorkerNetwork(self);
