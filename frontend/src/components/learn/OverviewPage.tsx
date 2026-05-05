import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const CAPABILITIES = [
  {
    title: "AgentCore Runtime",
    badge: "Compute",
    badgeColor: "bg-blue-100 text-blue-800",
    description:
      "A fully managed container execution environment for your AI agent code. Upload any Python agent (Strands, LangGraph, or custom) and AgentCore handles provisioning, scaling, session management, and secure invocation.",
    bullets: [
      "Zero infrastructure to manage — just your agent code",
      "Built-in multi-turn session context",
      "Streaming responses via Server-Sent Events",
      "Docker or ZIP deployment",
    ],
  },
  {
    title: "AgentCore Memory",
    badge: "State",
    badgeColor: "bg-purple-100 text-purple-800",
    description:
      "Persistent, searchable memory for AI agents. Automatically stores short-term conversation context and long-term user preferences. Memory is retrieved semantically — the agent always has the right context without you writing retrieval logic.",
    bullets: [
      "Short-term: full conversation history for the session",
      "Long-term: semantic search over past interactions",
      "Memory namespaced per user — no cross-contamination",
      "Native Strands and LangGraph integrations",
    ],
  },
  {
    title: "AgentCore Gateway",
    badge: "Tools",
    badgeColor: "bg-green-100 text-green-800",
    description:
      "A managed MCP (Model Context Protocol) server that exposes your Lambda functions as tools to agents. Define tool schemas once in CDK; the Gateway handles auth, routing, and protocol translation automatically.",
    bullets: [
      "Expose any Lambda as an MCP tool",
      "Built-in OAuth2 / M2M authentication",
      "Tools discoverable by agents at runtime",
      "No MCP server code to write or host",
    ],
  },
]

export function OverviewPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">What is Amazon Bedrock AgentCore?</h1>
        <p className="mt-3 text-lg text-gray-600">
          AgentCore is AWS's fully managed platform for deploying, running, and connecting AI agents
          at scale — without managing any of the underlying infrastructure.
        </p>
      </div>

      <div className="rounded-xl border border-orange-200 bg-orange-50 p-5">
        <p className="text-sm font-medium text-orange-900">
          <span className="font-bold">The core idea:</span> You write the agent logic. AgentCore handles everything else —
          compute, sessions, memory, tool connectivity, auth, and scaling.
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-800">Three Pillars</h2>
        {CAPABILITIES.map(cap => (
          <Card key={cap.title} className="border border-gray-200">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base">{cap.title}</CardTitle>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cap.badgeColor}`}>
                  {cap.badge}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-600">{cap.description}</p>
              <ul className="space-y-1.5">
                {cap.bullets.map(b => (
                  <li key={b} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-orange-400 flex-none" />
                    {b}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">This Demo App (FAST)</h3>
        <p className="text-sm text-gray-600">
          The <span className="font-mono text-xs bg-white border rounded px-1">FAST</span> template
          wires all three AgentCore pillars together into a deployable full-stack application: a React
          frontend, a Python Strands agent running in Runtime, Gateway-hosted tools, and Memory for
          persistent context — all secured with AWS Cognito and deployed via CDK.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {["React + TypeScript", "Python Strands Agent", "AWS CDK", "Amazon Cognito", "AgentCore Runtime", "AgentCore Memory", "AgentCore Gateway"].map(t => (
            <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
          ))}
        </div>
      </div>
    </div>
  )
}
