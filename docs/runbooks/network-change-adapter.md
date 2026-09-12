# Network change adapter setup

The current API stores an approved change, operator implementation evidence,
read-back verification and rollback evidence. It has no configured device
adapter and sends no commands to switches or controllers. The default
`unavailableNetworkConfiguration` port fails with `DEPENDENCY_UNAVAILABLE` and
performs no network I/O.

## Common integration profile

Use a vendor-neutral application boundary and select an adapter only after the
device/controller model is known. NETCONF (RFC 6241) or RESTCONF (RFC 8040) are
reasonable protocol candidates when the equipment exposes the required YANG
models; neither is assumed to be available by this repository. Do not enable
configuration by supplying only an endpoint URL.

Before wiring an adapter, document its model/API version, supported VLAN and
interface paths, authentication method, TLS trust configuration, secret
reference, timeout, and whether it supports confirmed commit or an equivalent
automatic rollback. The adapter must:

1. Check target identity and capabilities before mutation.
2. Read and retain the prior configuration in protected execution state.
3. Apply only the requested VLAN change with a bounded timeout.
4. Read the device back and report the observed VLAN and evidence reference.
5. Restore the captured prior configuration after a failed check and verify
   restoration. Never blindly retry an uncertain write.

Credentials belong in the deployment secret manager. Persist only a secret
reference and evidence references; never put credentials in task records,
request payloads, logs, or this runbook. The application port is
`NetworkConfigurationPort` in `modules/network/application/ports.ts`; its
snapshot/apply/verify/restore methods intentionally do not choose a vendor.

## OIDC step-up for high-risk changes

For a VLAN command, configure the IdP/client to return signed and verified
`auth_time`, `acr`, and `amr` claims. Map
`NETWORK_CHANGE_REQUIRED_ACR=urn:itcenter:acr:mfa` to the IdP's MFA assurance
policy. The API accepts the request only when `amr` contains `mfa`, `acr`
matches exactly, and `auth_time` is no more than
`NETWORK_CHANGE_MAX_AUTH_AGE_SECONDS` old (default 300 seconds). Otherwise it
returns the RFC 9470 `insufficient_user_authentication` challenge with
`acr_values` and `max_age`, allowing an OIDC client to initiate step-up.

If the IdP does not issue these claims or does not support step-up, high-risk
commands remain denied. Do not infer MFA from a user-supplied header or from an
authorization role. The current executable's authentication adapter is still
unconfigured, so production traffic remains fail-closed until a verified OIDC
adapter and policy mapping are deployed.
