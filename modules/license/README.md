# License Domain

Owns canonical entitlement terms and organizational license pools. Entitlement
effectiveness is derived from the current UTC validity window. Assignment,
activation, reservation, reclaim, compliance calculation, and usage remain out
of scope for this module until their owning task contracts are implemented.

Cross-domain product integrity is enforced through the tenant-composite
reference to the Software product identity. Contract and supplier references
are stored only as display/reference strings because their owning canonical
domains are not yet available; they do not grant authority or alter scope.

Expiry scanning returns newly recorded term/version facts to the caller. A
scheduled worker must write matching outbox/audit effects in the same unit of
work when it invokes that application operation.
