# Existing iOS simulators

This local registry leases user-owned simulators in Xcode's default device set.
Its SQLite file is shared by all Simlock installations for the current OS user,
including invocations with different daemon homes. It never adds device records
to the daemon, whose lifecycle can erase or delete virtual devices. Releasing a
lease changes only the registry.
