/**
 * MetricsPanel Component
 * Displays conversation metrics including token usage, memory events, agents, and tools
 */

import { useState } from "react"
import { AlertCircle, ChevronDown, ChevronUp, Info } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Agent, MetricsData, Tool } from "@/services/metricsService"

export interface MetricsPanelProps {
  sessionId: string
  isVisible: boolean
  onToggle: () => void
  metrics: MetricsData | null
  agents: Agent[]
  tools: Tool[]
  isLoading: boolean
  error: string | null
}

/**
 * Format large numbers with commas (e.g., 1,234)
 */
function formatNumber(num: number): string {
  return num.toLocaleString()
}

export function MetricsPanel({
  sessionId,
  isVisible,
  onToggle,
  metrics,
  agents,
  tools,
  isLoading,
  error,
}: MetricsPanelProps) {
  const [agentsExpanded, setAgentsExpanded] = useState(false)
  const [toolsExpanded, setToolsExpanded] = useState(false)

  if (!isVisible) {
    return null
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Conversation Metrics</CardTitle>
            <CardDescription>Session: {sessionId.slice(0, 8)}...</CardDescription>
          </div>
          <button
            onClick={onToggle}
            className="text-sm text-muted-foreground hover:text-foreground"
            aria-label="Close metrics panel"
          >
            ✕
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Error State */}
        {error && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        {/* Loading State */}
        {isLoading && !metrics && (
          <div className="text-center text-sm text-muted-foreground">Loading metrics...</div>
        )}

        {/* Token Metrics */}
        {metrics && (
          <>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold">Token Usage</h3>
                {metrics.isStale && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <AlertCircle className="h-4 w-4 text-yellow-500" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Metrics may be outdated</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">Input</div>
                  <div className="text-lg font-semibold">{formatNumber(metrics.tokens.input)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Output</div>
                  <div className="text-lg font-semibold">{formatNumber(metrics.tokens.output)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Total</div>
                  <div className="text-lg font-semibold">{formatNumber(metrics.tokens.total)}</div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Memory Metrics */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold">Memory Events</h3>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Number of events stored in AgentCore Memory</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {metrics.memory.error && (
                  <Badge variant="destructive" className="text-xs">
                    Error
                  </Badge>
                )}
              </div>
              <div className="text-lg font-semibold">{formatNumber(metrics.memory.eventCount)}</div>
              <div className="text-xs text-muted-foreground">
                Last updated: {new Date(metrics.lastUpdated).toLocaleTimeString()}
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Agents List */}
        <div>
          <button
            onClick={() => setAgentsExpanded(!agentsExpanded)}
            className="flex w-full items-center justify-between text-sm font-semibold hover:text-foreground"
          >
            <span>Available Agents ({agents.length})</span>
            {agentsExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          {agentsExpanded && (
            <div className="mt-2 space-y-2">
              {agents.length === 0 ? (
                <div className="text-sm text-muted-foreground">No agents available</div>
              ) : (
                agents.map((agent, index) => (
                  <div key={index} className="rounded-md border p-2">
                    <div className="text-sm font-medium">{agent.name}</div>
                    <div className="text-xs text-muted-foreground">{agent.description}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <Separator />

        {/* Tools List */}
        <div>
          <button
            onClick={() => setToolsExpanded(!toolsExpanded)}
            className="flex w-full items-center justify-between text-sm font-semibold hover:text-foreground"
          >
            <span>Available Tools ({tools.length})</span>
            {toolsExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          {toolsExpanded && (
            <div className="mt-2 space-y-2">
              {tools.length === 0 ? (
                <div className="text-sm text-muted-foreground">No tools available</div>
              ) : (
                tools.map((tool, index) => (
                  <div key={index} className="rounded-md border p-2">
                    <div className="text-sm font-medium">{tool.name}</div>
                    <div className="text-xs text-muted-foreground">{tool.description}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
