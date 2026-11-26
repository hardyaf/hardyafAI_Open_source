import test from "node:test";
import assert from "node:assert/strict";
import { HouseholdDatabase } from "../src/database.ts";
import { ConnectionRepository } from "../src/connections/repository.ts";

const sample = {
  id: "connection-example", ownerProfileId: "alex", label: "House mail", kind: "google" as const,
  secretId: "00000000-0000-0000-0000-000000000001", scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  status: "connected" as const, account: "house@example.invalid", accountId: "subject-example",
  createdAt: "2026-11-25T17:00:00.000Z", updatedAt: "2026-11-25T17:00:00.000Z",
};

test("connection metadata reuses household database and filters owner without storing secret fields", () => {
  const database = new HouseholdDatabase(":memory:");
  try {
    const repository = new ConnectionRepository(database.domainConnection());
    repository.save({ ...sample, password: "never-persist-this" } as typeof sample);
    assert.deepEqual(repository.get("alex", sample.id), sample);
    assert.equal(repository.get("natasha", sample.id), undefined);
    assert.deepEqual(repository.list("natasha"), []);
    const serialized = JSON.stringify(database.domainConnection().prepare("SELECT * FROM credential_connections").all());
    assert.equal(serialized.includes("never-persist-this"), false);
    assert.equal(Number(database.domainConnection().prepare("SELECT MAX(version) AS version FROM schema_migrations").get()!.version), 8);
  } finally { database.close(); }
});

test("connection IDs cannot transfer ownership and update preserves initial creation time", () => {
  const database = new HouseholdDatabase(":memory:");
  try {
    const repository = new ConnectionRepository(database.domainConnection());
    repository.save(sample);
    assert.throws(() => repository.save({ ...sample, ownerProfileId: "natasha" }), /connection_metadata_conflict/);
    repository.save({ ...sample, label: "Updated mail", createdAt: "2030-01-01T00:00:00.000Z" });
    assert.equal(repository.get("alex", sample.id)?.createdAt, sample.createdAt);
    assert.equal(repository.get("alex", sample.id)?.label, "Updated mail");
  } finally { database.close(); }
});
