export {
  PLATFORM_FAMILIES,
  createService,
  createPlatform,
  createServiceEnvironment,
  deactivateCatalog,
  readService,
  readPlatform,
  readServiceEnvironment,
  resolveObservedPlatform,
  serviceQueryPort,
  platformQueryPort,
  serviceEnvironmentQueryPort,
  updateCatalog,
} from "./application/catalog.js";
export type {
  CatalogKind,
  PlatformFamily,
  ServiceQueryPort,
  PlatformQueryPort,
  ServiceEnvironmentQueryPort,
} from "./application/catalog.js";
