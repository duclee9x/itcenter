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
export {
  createVlanChange,
  recordVlanImplementation,
  recordVlanRollback,
  startVlanChange,
  verifyVlanChange,
} from "./application/vlan-changes.js";
export type {
  NetworkException,
  NetworkExceptionQueuePort,
  NetworkConfigurationPort,
  NetworkTarget,
  NetworkSnapshot,
  NetworkApplyRequest,
  NetworkRestoreRequest,
} from "./application/ports.js";
export { unavailableNetworkConfiguration } from "./application/ports.js";
