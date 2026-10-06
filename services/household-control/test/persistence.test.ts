import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HouseholdDatabase } from "../src/database.ts";
import { MockHouseholdAgentAdapter } from "../src/mock-adapter.ts";
import { SqliteHouseholdStore } from "../src/sqlite-household-store.ts";

test("conversation and submission receipt survive a database reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hardy-home-restart-"));
  const path = join(directory, "household-control.sqlite");
  try {
    const firstDatabase = new HouseholdDatabase(path);
    const firstStore = new SqliteHouseholdStore(firstDatabase, new MockHouseholdAgentAdapter([]));
    const profile = firstStore.getProfile("alex");
    assert.ok(profile);
    const conversation = await firstStore.createConversation(profile, "Restart acceptance", null);
    const firstReceipt = await firstStore.submitMessage({
      profile,
      conversationId: conversation.id,
      text: "This message must be sent only once",
      submissionId: "restart-submission-0001",
    });
    assert.ok(firstReceipt);
    await firstStore.close();

    const reopenedDatabase = new HouseholdDatabase(path);
    const reopenedStore = new SqliteHouseholdStore(reopenedDatabase, new MockHouseholdAgentAdapter([]));
    const reopenedProfile = reopenedStore.getProfile("alex");
    assert.ok(reopenedProfile);
    assert.equal(reopenedStore.listConversations(reopenedProfile)[0]?.id, conversation.id);
    const replayedReceipt = await reopenedStore.submitMessage({
      profile: reopenedProfile,
      conversationId: conversation.id,
      text: "This message must be sent only once",
      submissionId: "restart-submission-0001",
    });
    assert.deepEqual(replayedReceipt, firstReceipt);
    await reopenedStore.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
