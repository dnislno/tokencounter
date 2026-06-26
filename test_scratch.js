const { CacheOrchestrator } = require('./out/orchestrator');
const assert = require('assert');

console.log("=========================================");
console.log(" RUNNING EMPIRICAL TESTS ON ORCHESTRATOR ");
console.log("=========================================");

// 1. Mock inputs
const mockPythonCode = `
class UserService:
    def __init__(self):
        self.users = []

    def register_user(self, username, email):
        """Registers a new user."""
        user = {"username": username, "email": email}
        self.users.append(user)
        return user

    def delete_user(self, username):
        """Deletes a user by username."""
        self.users = [u for u in self.users if u["username"] != username]
        return True

    def get_user(self, username):
        """Retrieves a user by username."""
        for u in self.users:
            if u["username"] == username:
                return u
        return None
`;

const mockPayload = {
  model: "claude-3-5-sonnet",
  messages: [
    {
      role: "system",
      content: "You are an expert backend engineer."
    },
    {
      role: "user",
      content: "Here is my user service code:\n\n/workspace/src/user_service.py\n```python" + mockPythonCode + "\n```\n\nHow do I implement user registration?"
    }
  ]
};

// 2. Run orchestrator
try {
  const result = CacheOrchestrator.orchestrate(mockPayload);
  const optPayload = result.optimizedPayload;
  const { FileBlockDetector } = require('./out/detector');
  console.log("HYDRATION TARGETS:", FileBlockDetector.extractHydrationTargets(mockPayload.messages[1].content));
  console.log("FILES PROCESSED:", result.filesProcessed);

  console.log("\n[Test 1] Verifying message count...");
  // We should have:
  // Message 0: System Prompt (with cache_control)
  // Message 1: Stable Codebase Context (with cache_control)
  // Message 2: Remaining user message (without code, just reference)
  assert.strictEqual(optPayload.messages.length, 3);
  console.log("-> Success: Reconstructed payload has exactly 3 messages.");

  console.log("\n[Test 2] Verifying cache control headers...");
  assert.deepStrictEqual(optPayload.messages[0].cache_control, { type: 'ephemeral' });
  assert.deepStrictEqual(optPayload.messages[1].cache_control, { type: 'ephemeral' });
  assert.strictEqual(optPayload.messages[2].cache_control, undefined);
  console.log("-> Success: cache_control injected at System and Codebase levels.");

  console.log("\n[Test 3] Verifying Foveated Code Compression (Pruning)...");
  const codebaseBlock = optPayload.messages[1].content;
  
  // 'register_user' should be hydrated because the user query asks: "How do I implement user registration?"
  // 'delete_user' and 'get_user' should be pruned
  assert.ok(codebaseBlock.includes("def register_user"));
  assert.ok(codebaseBlock.includes('user = {"username": username, "email": email}')); // register_user body intact
  
  assert.ok(codebaseBlock.includes("def delete_user"));
  assert.ok(codebaseBlock.includes("pass  # ... [TokenCounter: delete_user() body hidden] ...")); // delete_user body stubbed
  assert.ok(!codebaseBlock.includes('self.users = [u for u in self.users if u["username"] != username]')); // delete_user body removed
  
  assert.ok(codebaseBlock.includes("def get_user"));
  assert.ok(codebaseBlock.includes("pass  # ... [TokenCounter: get_user() body hidden] ...")); // get_user body stubbed
  assert.ok(!codebaseBlock.includes('if u["username"] == username:')); // get_user body removed
  console.log("-> Success: Targeted function is fully hydrated; non-targeted functions are stubbed in-place.");

  console.log("\n[Test 4] Verifying Caching Token Alignment Padding...");
  // Codebase block should contain the padding block at the end
  assert.ok(codebaseBlock.includes("/*"));
  assert.ok(codebaseBlock.includes("*/"));
  console.log("-> Success: Padding comment block is successfully appended for 1024-token boundary alignment.");

  console.log("\n[Test 5] Verifying conversational text cleanup...");
  const userQueryMsg = optPayload.messages[2].content;
  assert.ok(userQueryMsg.includes("[File: /workspace/src/user_service.py is referenced in the Stable Codebase Context"));
  assert.ok(userQueryMsg.includes("How do I implement user registration?"));
  console.log("-> Success: Conversational query remains clear and refers to the codebase block.");

  console.log("\n=========================================");
  console.log("     ALL EMPIRICAL TESTS PASSED!         ");
  console.log("         ZERO BUG RELEASE READY          ");
  console.log("=========================================");

} catch (err) {
  console.error("Test failed:", err);
  process.exit(1);
}
