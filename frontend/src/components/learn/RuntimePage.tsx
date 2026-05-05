import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

const CODE_ENTRYPOINT = `from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from strands import Agent

app = BedrockAgentCoreApp()

@app.entrypoint
async def agent_stream(payload: dict, context: RequestContext):
    user_query = payload.get("prompt")
    session_id = payload.get("runtimeSessionId")

    # IMPORTANT: Always extract user identity from the JWT context,
    # never from the payload — prevents impersonation via prompt injection.
    user_id = extract_user_id_from_context(context)

    agent = Agent(model="us.anthropic.claude-sonnet-4-5", tools=[...])

    async for event in agent.stream_async(user_query):
        yield json.loads(json.dumps(dict(event), default=str))

if __name__ == "__main__":
    app.run()`

const CODE_CDK = `// infra-cdk/lib/backend-stack.ts
const agentRuntime = new bedrockagentcore.CfnAgentRuntime(
  this, "AgentRuntime",
  {
    agentRuntimeName: \`\${stackName}-agent\`,
    agentRuntimeArtifact: {
      containerConfiguration: {
        containerUri: containerImage.imageUri,
      },
    },
    networkConfiguration: { networkMode: "PUBLIC" },
    // Execution role grants Bedrock InvokeModel + SSM access
    roleArn: agentRole.roleArn,
  }
)`

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="rounded-lg bg-gray-900 text-gray-100 p-4 overflow-x-auto text-xs leading-relaxed">
      <code>{code}</code>
    </pre>
  )
}

export function RuntimePage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">AgentCore Runtime</h1>
        <p className="mt-2 text-lg text-gray-600">
          A fully managed execution environment that runs your agent code as a container — no
          servers, no scaling config, no session management to write.
        </p>
      </div>

      {/* What it does */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { label: "Container Runtime", desc: "Runs any Docker image — bring your own Python dependencies" },
          { label: "Session Management", desc: "Maintains multi-turn context; each session gets its own isolated state" },
          { label: "Streaming", desc: "Yields events over SSE — text chunks, tool calls, and results in real time" },
          { label: "Auto-scaling", desc: "AWS manages concurrency; you pay only for execution time" },
          { label: "IAM Integration", desc: "Execution role grants scoped access to Bedrock, SSM, and other services" },
          { label: "ZIP or Docker", desc: "Fast ZIP deploys for pure-Python agents; Docker for custom dependencies" },
        ].map(item => (
          <Card key={item.label} className="border border-gray-200">
            <CardContent className="pt-4">
              <div className="text-sm font-semibold text-gray-900">{item.label}</div>
              <div className="text-sm text-gray-600 mt-1">{item.desc}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Entrypoint contract */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-gray-800">The Entrypoint Contract</h2>
        <p className="text-sm text-gray-600">
          Every agent must use <code className="bg-gray-100 px-1 rounded text-xs">BedrockAgentCoreApp</code> and
          expose an <code className="bg-gray-100 px-1 rounded text-xs">@app.entrypoint</code> async generator.
          AgentCore calls this function with the user payload and a validated request context.
        </p>
        <CodeBlock code={CODE_ENTRYPOINT} />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <span className="font-semibold">Security note:</span> The <code className="bg-amber-100 px-1 rounded text-xs">context</code> object
          carries the JWT-validated user identity. Never trust <code className="bg-amber-100 px-1 rounded text-xs">payload</code> for
          user ID — it is user-controlled and can be spoofed.
        </div>
      </div>

      {/* Supported agent frameworks */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-gray-800">Supported Agent Frameworks</h2>
        <div className="space-y-3">
          {[
            {
              name: "Strands",
              badge: "Default in FAST",
              badgeVariant: "default" as const,
              desc: "AWS's open-source agentic SDK. Declarative tool registration, built-in streaming, and native AgentCore Memory integration. This is what FAST ships by default.",
              path: "patterns/strands-single-agent/",
            },
            {
              name: "LangGraph",
              badge: "Also supported",
              badgeVariant: "outline" as const,
              desc: "Graph-based agent orchestration from LangChain. Good for complex multi-step workflows with conditional branching. FAST includes a ready-to-use LangGraph pattern.",
              path: "patterns/langgraph-single-agent/",
            },
            {
              name: "Custom",
              badge: "Bring your own",
              badgeVariant: "outline" as const,
              desc: "Any Python agent that implements the entrypoint contract works. Use OpenAI SDK, Bedrock Converse API directly, or any other framework.",
              path: "patterns/your-pattern/",
            },
          ].map(fw => (
            <div key={fw.name} className="flex gap-4 p-4 rounded-lg border border-gray-200">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{fw.name}</span>
                  <Badge variant={fw.badgeVariant} className="text-xs">{fw.badge}</Badge>
                </div>
                <p className="text-sm text-gray-600 mt-1">{fw.desc}</p>
              </div>
              <div className="flex-none">
                <code className="text-xs bg-gray-100 rounded px-2 py-1 text-gray-600">{fw.path}</code>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CDK deployment */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-gray-800">CDK Deployment</h2>
        <p className="text-sm text-gray-600">
          The Runtime resource is declared in CDK. FAST's <code className="bg-gray-100 px-1 rounded text-xs">infra-cdk/lib/backend-stack.ts</code> provisions
          the runtime, builds the container image, pushes it to ECR, and wires up the IAM execution role automatically.
        </p>
        <CodeBlock code={CODE_CDK} />
      </div>

      {/* Key config */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-gray-800">Key Configuration</h2>
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-semibold text-gray-700">Setting</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-700">Where</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-700">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                ["pattern", "config.yaml → pattern", "Which agent pattern to deploy (strands-single-agent, langgraph-single-agent)"],
                ["deployment_type", "config.yaml → deployment_type", "docker (default) or zip"],
                ["MEMORY_ID", "Runtime env var", "AgentCore Memory resource ID — injected by CDK"],
                ["STACK_NAME", "Runtime env var", "Used to look up Gateway URL and M2M credentials from SSM"],
              ].map(([setting, where, desc]) => (
                <tr key={setting} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-purple-700">{setting}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{where}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
