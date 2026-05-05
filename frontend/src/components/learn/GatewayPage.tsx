const CODE_LAMBDA = `import json, logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event: dict, context) -> dict:
    # Tool name comes from Lambda context, NOT the event body.
    # This is an AgentCore Gateway requirement.
    raw_name = context.client_context.custom['bedrockAgentCoreToolName']

    # Strip the Gateway-injected prefix (e.g. "gateway___my_tool" → "my_tool")
    delimiter = "___"
    tool_name = raw_name.split(delimiter)[-1] if delimiter in raw_name else raw_name

    logger.info(f"Tool: {tool_name}, args: {json.dumps(event)}")

    if tool_name == "search_knowledge_base":
        results = search_kb(event["query"])
        return {"content": [{"type": "text", "text": json.dumps(results)}]}

    elif tool_name == "send_notification":
        send(event["recipient"], event["message"])
        return {"content": [{"type": "text", "text": "Notification sent."}]}

    else:
        raise ValueError(f"Unknown tool: {tool_name}")`

const CODE_CDK = `// infra-cdk/lib/backend-stack.ts
const myToolsLambda = new lambda.Function(this, "MyTools", {
  runtime: lambda.Runtime.PYTHON_3_12,
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambdas/my-tools"),
});

// Register tools on the Gateway — each tool needs a JSON Schema
gateway.addLambdaTarget({
  targetName: "search_knowledge_base",
  targetLambda: myToolsLambda,
  description: "Search the internal knowledge base",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
    },
    required: ["query"],
  },
})`

const CODE_AGENT = `# The agent discovers tools automatically — no hardcoded list needed.
# The Gateway exposes them via MCP; Strands enumerates at startup.

gateway_client = MCPClient(
    lambda: streamablehttp_client(
        url=gateway_url,
        headers={"Authorization": f"Bearer {access_token}"},
    ),
    prefix="gateway",
)

with gateway_client:
    tools = gateway_client.list_tools_sync()
    agent = Agent(model="...", tools=tools)
    response = agent(user_query)`

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="rounded-lg bg-gray-900 text-gray-100 p-4 overflow-x-auto text-xs leading-relaxed">
      <code>{code}</code>
    </pre>
  )
}

export function GatewayPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">AgentCore Gateway & Tools</h1>
        <p className="mt-2 text-lg text-gray-600">
          A managed MCP server that turns your Lambda functions into agent tools — with built-in
          auth, routing, and discovery. No MCP server to build or host.
        </p>
      </div>

      {/* What the Gateway does */}
      <div className="rounded-xl border border-green-200 bg-green-50 p-5 space-y-2">
        <h3 className="font-semibold text-green-900">The Gateway solves tool connectivity</h3>
        <p className="text-sm text-green-800">
          Agents need to call external APIs — databases, notification services, internal systems.
          Normally you'd build auth middleware, handle protocol translation, and manage tool
          discovery yourself. AgentCore Gateway does all of this: expose a Lambda, get an
          MCP-compliant tool endpoint with OAuth2 protection automatically.
        </p>
      </div>

      {/* Architecture diagram */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Gateway Flow</h2>
        <svg viewBox="0 0 720 160" className="w-full" xmlns="http://www.w3.org/2000/svg" fontFamily="ui-sans-serif, system-ui, sans-serif">
          {/* Agent */}
          <rect x="20" y="50" width="120" height="60" rx="8" fill="#fdf4ff" stroke="#c084fc" strokeWidth="1.5" />
          <text x="80" y="76" textAnchor="middle" fontSize="11" fontWeight="600" fill="#7e22ce">Strands Agent</text>
          <text x="80" y="92" textAnchor="middle" fontSize="9" fill="#6b21a8">MCP client</text>

          {/* Gateway */}
          <rect x="210" y="40" width="140" height="80" rx="8" fill="#f0fdf4" stroke="#4ade80" strokeWidth="1.5" />
          <text x="280" y="72" textAnchor="middle" fontSize="11" fontWeight="600" fill="#15803d">AgentCore</text>
          <text x="280" y="88" textAnchor="middle" fontSize="11" fontWeight="600" fill="#15803d">Gateway</text>
          <text x="280" y="104" textAnchor="middle" fontSize="9" fill="#166534">MCP server + OAuth2</text>

          {/* Lambda tools */}
          <rect x="440" y="20" width="120" height="45" rx="8" fill="#f0fdf4" stroke="#4ade80" strokeWidth="1.5" />
          <text x="500" y="40" textAnchor="middle" fontSize="11" fontWeight="600" fill="#15803d">Lambda A</text>
          <text x="500" y="56" textAnchor="middle" fontSize="9" fill="#166534">search_kb tool</text>

          <rect x="440" y="95" width="120" height="45" rx="8" fill="#f0fdf4" stroke="#4ade80" strokeWidth="1.5" />
          <text x="500" y="115" textAnchor="middle" fontSize="11" fontWeight="600" fill="#15803d">Lambda B</text>
          <text x="500" y="131" textAnchor="middle" fontSize="9" fill="#166534">send_notification</text>

          {/* Arrows */}
          <line x1="140" y1="80" x2="208" y2="80" stroke="#4ade80" strokeWidth="1.5" markerEnd="url(#m-g)" />
          <text x="174" y="72" textAnchor="middle" fontSize="8" fill="#6b7280">MCP / HTTP</text>
          <line x1="350" y1="65" x2="438" y2="48" stroke="#4ade80" strokeWidth="1.5" markerEnd="url(#m-g)" />
          <line x1="350" y1="95" x2="438" y2="112" stroke="#4ade80" strokeWidth="1.5" markerEnd="url(#m-g)" />

          {/* Cognito */}
          <rect x="580" y="55" width="120" height="50" rx="8" fill="#fff7ed" stroke="#fb923c" strokeWidth="1.5" />
          <text x="640" y="77" textAnchor="middle" fontSize="11" fontWeight="600" fill="#c2410c">Cognito</text>
          <text x="640" y="93" textAnchor="middle" fontSize="9" fill="#9a3412">M2M tokens</text>

          <line x1="350" y1="80" x2="578" y2="80" stroke="#fb923c" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#m-o)" />
          <text x="464" y="76" textAnchor="middle" fontSize="8" fill="#6b7280">validates</text>

          <defs>
            <marker id="m-g" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L7,3 z" fill="#4ade80" />
            </marker>
            <marker id="m-o" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L7,3 z" fill="#fb923c" />
            </marker>
          </defs>
        </svg>
      </div>

      {/* Lambda implementation */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-gray-800">Lambda Tool Implementation</h2>
        <p className="text-sm text-gray-600">
          Each Lambda receives the tool name in the Lambda <em>context</em> (not the event). A single Lambda
          can handle multiple tools by routing on the extracted name.
        </p>
        <CodeBlock code={CODE_LAMBDA} />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <span className="font-semibold">Common gotcha:</span> The tool name in context includes a
          Gateway-generated prefix (<code className="bg-amber-100 px-1 rounded text-xs">gateway___</code>).
          Always strip the prefix before routing — see the <code className="bg-amber-100 px-1 rounded text-xs">delimiter</code> pattern above.
        </div>
      </div>

      {/* CDK registration */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-gray-800">Registering Tools in CDK</h2>
        <p className="text-sm text-gray-600">
          Tools are declared in CDK with a JSON Schema for input validation. The Gateway auto-generates
          the MCP tool manifest from these schemas — agents discover tools at runtime without any hardcoding.
        </p>
        <CodeBlock code={CODE_CDK} />

        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-semibold text-gray-700">JSON Schema type</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-700">Python type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                ['"string"', "str"],
                ['"integer"', "int"],
                ['"number"', "float"],
                ['"boolean"', "bool"],
                ['"array"', "list"],
                ['"object"', "dict"],
              ].map(([json, py]) => (
                <tr key={json} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-green-700">{json}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-600">{py}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent connection */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-gray-800">Connecting the Agent</h2>
        <p className="text-sm text-gray-600">
          The agent fetches Gateway credentials from SSM, opens an MCP client connection, and lists
          available tools. Strands uses these tools automatically when the agent decides to call them.
        </p>
        <CodeBlock code={CODE_AGENT} />
      </div>

      {/* Debugging */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-2">
        <h3 className="text-sm font-semibold text-gray-800">Debugging tools</h3>
        <ul className="space-y-1.5">
          {[
            { cmd: "python3 scripts/test-gateway.py", desc: "End-to-end test: auth, list tools, invoke a tool" },
            { cmd: 'exceptionLevel: "DEBUG"', desc: 'Enable verbose Gateway errors in CDK — check CloudWatch at /aws/bedrock-agentcore/gateway/*' },
          ].map(item => (
            <li key={item.cmd} className="flex flex-col gap-0.5">
              <code className="text-xs bg-white border rounded px-2 py-1 text-gray-800 w-fit">{item.cmd}</code>
              <span className="text-xs text-gray-600 pl-1">{item.desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
