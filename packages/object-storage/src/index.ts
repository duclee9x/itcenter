export interface ObjectReference {
  key: string;
  checksum: string;
  content_type: string;
  size_bytes: number;
}
export interface ObjectStore {
  /** Must be explicitly asserted by a production adapter; test/fake adapters omit it. */
  production_verified?: boolean;
  head(key: string): Promise<ObjectReference | null>;
}
// Provider implementation deferred until evidence upload is assigned. No binary data in OLTP.
