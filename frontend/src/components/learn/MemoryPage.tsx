const CODE_STRANDS = `from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig

# Configure memory — session_id scopes to this conversation,
# actor_id scopes long-term memory to this user.
config = AgentCoreMemoryConfig(
    memory_id=memory_id,      # from MEMORY_ID env var
    session_id=session_id,    # from request payload
    actor_id=user_id,         # from JWT context (never payload!)
)

session_manager = AgentCoreMemorySessionManager(
    agentcore_memory_config=config,
    region_name=region,
)

# Pass session_manager to Strands — it handles retrieval automatically
agent = Agent(
    model="us.anthropic.claude-sonnet-4-5",
    tools=[...],
    conversation_manager=session_manager,
)`

const CODE_CDK = `// infra-cdk/lib/backend-stack.ts
const memory = new bedrockagentcore.CfnMemory(this, "AgentCoreMemory", {
  memoryName: \`\${stackName}-memory\`,
  memoryStrategies: [
    {
      semanticMemoryStrategy: {
        name: "semantic-strategy",
        // Automatically extracts and stores semantic facts
        // from conversations for long-term recall
      },
    },
  ],
})`

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="rounded-lg bg-gray-900 text-gray-100 p-4 overflow-x-auto text-xs leading-relaxed">
      <code>{code}</code>
    </pre>
  )
}

export function MemoryPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">AgentCore Memory</h1>
        <p className="mt-2 text-lg text-gray-600">
          Persistent, scoped memory that gives agents context across sessions — without you building
          a retrieval system from scratch.
        </p>
      </div>

      {/* Two memory types */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-purple-200 bg-purple-50 p-5 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-purple-500" />
            <h3 className="font-semibold text-purple-900">Short-term Memory</h3>
          </div>
          <p className="text-sm text-purple-800">
            Full conversation history for the active session. Automatically injected into the agent's
            context window on every turn — the agent "remembers" what was said earlier in the chat.
          </p>
          <ul className="space-y-1 pt-1">
            {[
              "Scoped to a single session_id",
              "In-order message history",
              "Cleared when the session ends",
              "Zero retrieval logic needed",
            ].map(b => (
              <li key={b} className="flex items-start gap-2 text-xs text-purple-700">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-purple-400 flex-none" />
                {b}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-indigo-500" />
            <h3 className="font-semibold text-indigo-900">Long-term Memory</h3>
          </div>
          <p className="text-sm text-indigo-800">
            Semantic facts extracted from past conversations and stored per user (actor_id). Retrieved
            by relevance using vector search — the agent knows your preferences across sessions.
          </p>
          <ul className="space-y-1 pt-1">
            {[
              "Scoped to an actor_id (user)",
              "Semantic similarity search",
              "Persists across sessions",
              "Automatic fact extraction",
            ].map(b => (
              <li key={b} className="flex items-start gap-2 text-xs text-indigo-700">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-indigo-400 flex-none" />
                {b}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Memory flow diagram */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Memory Flow</h2>
        <svg viewBox="0 0 700 180" className="w-full" xmlns="http://www.w3.org/2000/svg" fontFamily="ui-sans-serif, system-ui, sans-serif">
          {/* User */}
          <rect x="20" y="65" width="100" height="50" rx="8" fill="#ede9fe" stroke="#a78bfa" strokeWidth="1.5" />
          <text x="70" y="87" textAnchor="middle" fontSize="11" fontWeight="600" fill="#4c1d95">User</text>
          <text x="70" y="103" textAnchor="middle" fontSize="9" fill="#6d28d9">message</text>

          {/* Agent */}
          <rect x="200" y="55" width="130" height="70" rx="8" fill="#fdf4ff" stroke="#c084fc" strokeWidth="1.5" />
          <text x="265" y="82" textAnchor="middle" fontSize="11" fontWeight="600" fill="#7e22ce">Strands Agent</text>
          <text x="265" y="98" textAnchor="middle" fontSize="9" fill="#6b21a8">retrieves context</text>
          <text x="265" y="112" textAnchor="middle" fontSize="9" fill="#6b21a8">+ stores events</text>

          {/* Short-term */}
          <rect x="430" y="20" width="140" height="50" rx="8" fill="#ede9fe" stroke="#a78bfa" strokeWidth="1.5" />
          <text x="500" y="42" textAnchor="middle" fontSize="11" fontWeight="600" fill="#4c1d95">Short-term</text>
          <text x="500" y="58" textAnchor="middle" fontSize="9" fill="#6d28d9">Session history</text>

          {/* Long-term */}
          <rect x="430" y="110" width="140" height="50" rx="8" fill="#e0e7ff" stroke="#818cf8" strokeWidth="1.5" />
          <text x="500" y="132" textAnchor="middle" fontSize="11" fontWeight="600" fill="#1e1b4b">Long-term</text>
          <text x="500" y="148" textAnchor="middle" fontSize="9" fill="#3730a3">Semantic facts</text>

          {/* Arrows */}
          <line x1="120" y1="90" x2="198" y2="90" stroke="#a78bfa" strokeWidth="1.5" markerEnd="url(#m-purple)" />
          <line x1="330" y1="75" x2="428" y2="50" stroke="#a78bfa" strokeWidth="1.5" markerEnd="url(#m-purple)" />
          <line x1="428" y1="60" x2="330" y2="82" stroke="#a78bfa" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#m-purple)" />
          <line x1="330" y1="105" x2="428" y2="130" stroke="#818cf8" strokeWidth="1.5" markerEnd="url(#m-indigo)" />
          <line x1="428" y1="140" x2="330" y2="112" stroke="#818cf8" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#m-indigo)" />

          <defs>
            <marker id="m-purple" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L7,3 z" fill="#a78bfa" />
            </marker>
            <marker id="m-indigo" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L7,3 z" fill="#818cf8" />
            </marker>
          </defs>
        </svg>
        <p className="text-xs text-gray-500 mt-2 text-center">Solid = write, Dashed = read/retrieve</p>
      </div>

      {/* Strands integration code */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-gray-800">Strands Integration</h2>
        <p className="text-sm text-gray-600">
          FAST's Strands agent uses <code className="bg-gray-100 px-1 rounded text-xs">AgentCoreMemorySessionManager</code> as
          the <code className="bg-gray-100 px-1 rounded text-xs">conversation_manager</code>. Strands calls it automatically
          before and after each agent turn — no manual retrieval or storage code needed.
        </p>
        <CodeBlock code={CODE_STRANDS} />
      </div>

      {/* CDK */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-gray-800">CDK Resource</h2>
        <p className="text-sm text-gray-600">
          Memory is declared in CDK with a semantic strategy. The <code className="bg-gray-100 px-1 rounded text-xs">MEMORY_ID</code> is
          injected into the agent container as an environment variable at deploy time.
        </p>
        <CodeBlock code={CODE_CDK} />
      </div>

      {/* Scoping callout */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-1">
        <h3 className="text-sm font-semibold text-amber-900">Memory isolation is your responsibility</h3>
        <p className="text-sm text-amber-800">
          Always pass <code className="bg-amber-100 px-1 rounded text-xs">actor_id</code> from the JWT-validated context — never from the
          user payload. If you use the wrong actor_id, users can read each other's long-term memory.
          FAST enforces this in <code className="bg-amber-100 px-1 rounded text-xs">gateway/utils/auth.py → extract_user_id_from_context()</code>.
        </p>
      </div>
    </div>
  )
}
