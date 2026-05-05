export function ArchitecturePage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Architecture</h1>
        <p className="mt-2 text-lg text-gray-600">
          How a user message flows from the browser to your agent and back.
        </p>
      </div>

      {/* Flow Diagram */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 overflow-x-auto">
        <svg
          viewBox="0 0 900 480"
          className="w-full min-w-[600px]"
          xmlns="http://www.w3.org/2000/svg"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {/* ── Layer labels ── */}
          <text x="12" y="44" fontSize="10" fill="#9ca3af" fontWeight="600" letterSpacing="1">BROWSER</text>
          <text x="12" y="164" fontSize="10" fill="#9ca3af" fontWeight="600" letterSpacing="1">AWS CLOUD</text>
          <text x="12" y="304" fontSize="10" fill="#9ca3af" fontWeight="600" letterSpacing="1">AGENTCORE</text>
          <text x="12" y="424" fontSize="10" fill="#9ca3af" fontWeight="600" letterSpacing="1">AWS SERVICES</text>

          {/* ── Swim lane backgrounds ── */}
          <rect x="0" y="50" width="900" height="100" rx="0" fill="#f8fafc" />
          <rect x="0" y="170" width="900" height="110" rx="0" fill="#f0f9ff" />
          <rect x="0" y="310" width="900" height="110" rx="0" fill="#fdf4ff" />
          <rect x="0" y="430" width="900" height="40" rx="0" fill="#f0fdf4" />

          {/* ════ BROWSER LAYER ════ */}
          {/* React App */}
          <rect x="60" y="70" width="130" height="60" rx="8" fill="#fff7ed" stroke="#fb923c" strokeWidth="1.5" />
          <text x="125" y="96" textAnchor="middle" fontSize="12" fontWeight="600" fill="#c2410c">React App</text>
          <text x="125" y="112" textAnchor="middle" fontSize="10" fill="#9a3412">Vite + Tailwind</text>

          {/* Cognito login */}
          <rect x="230" y="70" width="130" height="60" rx="8" fill="#fff7ed" stroke="#fb923c" strokeWidth="1.5" />
          <text x="295" y="96" textAnchor="middle" fontSize="12" fontWeight="600" fill="#c2410c">Cognito Login</text>
          <text x="295" y="112" textAnchor="middle" fontSize="10" fill="#9a3412">OIDC / JWT tokens</text>

          {/* Arrow: React → Cognito */}
          <line x1="190" y1="100" x2="228" y2="100" stroke="#fb923c" strokeWidth="1.5" markerEnd="url(#arr-orange)" />

          {/* ════ AWS CLOUD LAYER ════ */}
          {/* Amplify */}
          <rect x="60" y="185" width="130" height="60" rx="8" fill="#eff6ff" stroke="#60a5fa" strokeWidth="1.5" />
          <text x="125" y="211" textAnchor="middle" fontSize="12" fontWeight="600" fill="#1d4ed8">AWS Amplify</text>
          <text x="125" y="227" textAnchor="middle" fontSize="10" fill="#1e40af">Hosts React app</text>

          {/* API Gateway */}
          <rect x="230" y="185" width="130" height="60" rx="8" fill="#eff6ff" stroke="#60a5fa" strokeWidth="1.5" />
          <text x="295" y="205" textAnchor="middle" fontSize="12" fontWeight="600" fill="#1d4ed8">API Gateway</text>
          <text x="295" y="221" textAnchor="middle" fontSize="10" fill="#1e40af">REST + Cognito</text>
          <text x="295" y="235" textAnchor="middle" fontSize="10" fill="#1e40af">authorizer</text>

          {/* Auth Lambda */}
          <rect x="400" y="185" width="130" height="60" rx="8" fill="#eff6ff" stroke="#60a5fa" strokeWidth="1.5" />
          <text x="465" y="205" textAnchor="middle" fontSize="12" fontWeight="600" fill="#1d4ed8">Auth Lambda</text>
          <text x="465" y="221" textAnchor="middle" fontSize="10" fill="#1e40af">Token exchange</text>
          <text x="465" y="235" textAnchor="middle" fontSize="10" fill="#1e40af">M2M credentials</text>

          {/* Arrow: Amplify → API GW */}
          <line x1="190" y1="215" x2="228" y2="215" stroke="#60a5fa" strokeWidth="1.5" markerEnd="url(#arr-blue)" />
          {/* Arrow: API GW → Auth Lambda */}
          <line x1="360" y1="215" x2="398" y2="215" stroke="#60a5fa" strokeWidth="1.5" markerEnd="url(#arr-blue)" />

          {/* Vertical: React → Amplify */}
          <line x1="125" y1="130" x2="125" y2="183" stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 3" markerEnd="url(#arr-gray)" />

          {/* ════ AGENTCORE LAYER ════ */}
          {/* AgentCore Runtime */}
          <rect x="60" y="325" width="155" height="60" rx="8" fill="#fdf4ff" stroke="#c084fc" strokeWidth="1.5" />
          <text x="137" y="345" textAnchor="middle" fontSize="12" fontWeight="600" fill="#7e22ce">AgentCore</text>
          <text x="137" y="361" textAnchor="middle" fontSize="12" fontWeight="600" fill="#7e22ce">Runtime</text>
          <text x="137" y="376" textAnchor="middle" fontSize="10" fill="#6b21a8">Python agent (Strands)</text>

          {/* AgentCore Memory */}
          <rect x="255" y="325" width="155" height="60" rx="8" fill="#fdf4ff" stroke="#c084fc" strokeWidth="1.5" />
          <text x="332" y="345" textAnchor="middle" fontSize="12" fontWeight="600" fill="#7e22ce">AgentCore</text>
          <text x="332" y="361" textAnchor="middle" fontSize="12" fontWeight="600" fill="#7e22ce">Memory</text>
          <text x="332" y="376" textAnchor="middle" fontSize="10" fill="#6b21a8">Short + long-term</text>

          {/* AgentCore Gateway */}
          <rect x="450" y="325" width="155" height="60" rx="8" fill="#fdf4ff" stroke="#c084fc" strokeWidth="1.5" />
          <text x="527" y="345" textAnchor="middle" fontSize="12" fontWeight="600" fill="#7e22ce">AgentCore</text>
          <text x="527" y="361" textAnchor="middle" fontSize="12" fontWeight="600" fill="#7e22ce">Gateway</text>
          <text x="527" y="376" textAnchor="middle" fontSize="10" fill="#6b21a8">MCP tool server</text>

          {/* Arrow: Auth Lambda → Runtime (cross-lane) */}
          <path d="M 465 245 L 465 305 L 140 305 L 140 323" stroke="#c084fc" strokeWidth="1.5" fill="none" strokeDasharray="5 3" markerEnd="url(#arr-purple)" />

          {/* Arrow: Runtime ↔ Memory */}
          <line x1="215" y1="355" x2="253" y2="355" stroke="#c084fc" strokeWidth="1.5" markerEnd="url(#arr-purple)" />
          <line x1="253" y1="365" x2="215" y2="365" stroke="#c084fc" strokeWidth="1.5" markerEnd="url(#arr-purple)" />

          {/* Arrow: Runtime → Gateway */}
          <line x1="215" y1="345" x2="448" y2="345" stroke="#c084fc" strokeWidth="1.5" markerEnd="url(#arr-purple)" />

          {/* ════ AWS SERVICES LAYER ════ */}
          {/* Lambda tools */}
          <rect x="450" y="437" width="155" height="26" rx="6" fill="#f0fdf4" stroke="#4ade80" strokeWidth="1.5" />
          <text x="527" y="454" textAnchor="middle" fontSize="11" fontWeight="600" fill="#15803d">Lambda Tools</text>

          {/* Arrow: Gateway → Lambda */}
          <line x1="527" y1="385" x2="527" y2="435" stroke="#4ade80" strokeWidth="1.5" markerEnd="url(#arr-green)" />

          {/* Claude model */}
          <rect x="650" y="325" width="155" height="60" rx="8" fill="#fff7ed" stroke="#fb923c" strokeWidth="1.5" />
          <text x="727" y="345" textAnchor="middle" fontSize="12" fontWeight="600" fill="#c2410c">Claude on</text>
          <text x="727" y="361" textAnchor="middle" fontSize="12" fontWeight="600" fill="#c2410c">Amazon Bedrock</text>
          <text x="727" y="376" textAnchor="middle" fontSize="10" fill="#9a3412">LLM inference</text>

          {/* Arrow: Runtime → Claude */}
          <line x1="215" y1="375" x2="648" y2="355" stroke="#fb923c" strokeWidth="1.5" markerEnd="url(#arr-orange)" />

          {/* SSE response arrow back */}
          <path d="M 727 385 L 727 470 L 125 470 L 125 132" stroke="#9ca3af" strokeWidth="1.5" fill="none" strokeDasharray="5 3" markerEnd="url(#arr-gray)" />
          <text x="430" y="485" textAnchor="middle" fontSize="10" fill="#6b7280">Streaming SSE response</text>

          {/* ── Arrow markers ── */}
          <defs>
            <marker id="arr-orange" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#fb923c" />
            </marker>
            <marker id="arr-blue" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#60a5fa" />
            </marker>
            <marker id="arr-purple" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#c084fc" />
            </marker>
            <marker id="arr-green" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#4ade80" />
            </marker>
            <marker id="arr-gray" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#9ca3af" />
            </marker>
          </defs>
        </svg>
      </div>

      {/* Step-by-step walkthrough */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-800">Request Flow — Step by Step</h2>
        <div className="space-y-3">
          {[
            {
              n: "1",
              color: "bg-orange-100 text-orange-800 border-orange-200",
              title: "User authenticates via Amazon Cognito",
              body: "The React app redirects to Cognito's hosted UI. After login, Cognito issues an OIDC ID token and access token stored in the browser.",
            },
            {
              n: "2",
              color: "bg-blue-100 text-blue-800 border-blue-200",
              title: "Message sent to API Gateway",
              body: "The frontend POSTs the user message with the Bearer token. API Gateway's Cognito authorizer validates the JWT — requests without a valid token are rejected at this layer.",
            },
            {
              n: "3",
              color: "bg-blue-100 text-blue-800 border-blue-200",
              title: "Auth Lambda exchanges tokens",
              body: "A Lambda function obtains machine-to-machine (M2M) credentials from Cognito — a separate client secret stored in SSM Parameter Store — then forwards the request to AgentCore Runtime.",
            },
            {
              n: "4",
              color: "bg-purple-100 text-purple-800 border-purple-200",
              title: "AgentCore Runtime invokes the agent",
              body: "Runtime spins up (or reuses) a container running your Python agent. It passes the prompt and session ID. The agent's user identity is extracted from the validated JWT context, never from the payload.",
            },
            {
              n: "5",
              color: "bg-purple-100 text-purple-800 border-purple-200",
              title: "Agent retrieves memory & calls tools",
              body: "AgentCore Memory provides prior conversation context. When the agent needs external data, it calls tools via the AgentCore Gateway — a managed MCP server that routes to Lambda functions.",
            },
            {
              n: "6",
              color: "bg-orange-100 text-orange-800 border-orange-200",
              title: "Claude generates a response",
              body: "The Strands agent invokes Claude via Amazon Bedrock. Tool results, memory context, and the user query are all included in the prompt.",
            },
            {
              n: "7",
              color: "bg-gray-100 text-gray-800 border-gray-200",
              title: "Streaming response back to the browser",
              body: "AgentCore Runtime streams events (text chunks, tool calls, tool results) back through API Gateway as Server-Sent Events. The React frontend renders them incrementally.",
            },
          ].map(step => (
            <div key={step.n} className={`flex gap-4 p-4 rounded-lg border ${step.color}`}>
              <div className="flex-none font-bold text-sm w-5 pt-0.5">{step.n}</div>
              <div>
                <div className="font-medium text-sm">{step.title}</div>
                <div className="text-sm mt-0.5 opacity-80">{step.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
