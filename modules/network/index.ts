export {
  createDiscoveryJob,
  normalizeNetworkObservation,
  readCurrentTopology,
  recordDiscoveryObservation,
  transitionDiscoveryJob,
} from "./application/discovery.js";
export {
  compareExpectedVlan,
  detectObservationExceptions,
  listNetworkExceptions,
  resolveNetworkException,
} from "./application/exceptions.js";
export type {
  NetworkException,
  NetworkExceptionQueuePort,
} from "./application/ports.js";
