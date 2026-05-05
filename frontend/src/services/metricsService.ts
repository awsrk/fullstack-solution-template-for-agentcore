/**
 * Metrics Service
 * Handles fetching conversation metrics, agents, and tools from the backend API
 */

// Load API URL from aws-exports.json
let METRICS_API_BASE_URL = ""

/**
 * Dynamically load the API URL from aws-exports.json
 */
async function loadApiUrl(): Promise<string> {
  if (METRICS_API_BASE_URL) {
    return METRICS_API_BASE_URL
  }

  try {
    const response = await fetch("/aws-exports.json")
    const config = await response.json()
    METRICS_API_BASE_URL = config.feedbackApiUrl || ""
    return METRICS_API_BASE_URL
  } catch (error) {
    console.error("Failed to load API URL from aws-exports.json:", error)
    throw new Error("Metrics API URL not configured")
  }
}

// TypeScript interfaces for API responses

export interface TokenMetrics {
  input: number
  output: number
  total: number
}

export interface MemoryMetrics {
  eventCount: number
  error?: boolean
}

export interface MetricsData {
  tokens: TokenMetrics
  memory: MemoryMetrics
  lastUpdated: string
  isStale?: boolean
}

export interface Agent {
  name: string
  description: string
}

export interface Tool {
  name: string
  description: string
}

export interface AgentsResponse {
  agents: Agent[]
  error?: string
}

export interface ToolsResponse {
  tools: Tool[]
  error?: string
}

/**
 * Metrics Service class
 * Provides methods to fetch metrics, agents, and tools with retry logic and caching
 */
export class MetricsService {
  private cache: MetricsData | null = null
  private retryConfig = {
    maxAttempts: 3,
    baseDelay: 1000, // ms
    maxDelay: 8000, // ms
  }

  /**
   * Fetch conversation metrics for a session
   *
   * @param sessionId - Conversation session identifier
   * @param idToken - Cognito ID token for authentication
   * @returns Promise with metrics data
   */
  async fetchMetrics(sessionId: string, idToken: string): Promise<MetricsData> {
    const apiUrl = await loadApiUrl()
    const url = `${apiUrl}metrics?sessionId=${encodeURIComponent(sessionId)}`

    try {
      const data = await this.retryWithBackoff(async () => {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        return await response.json()
      })

      // Update cache with fresh data
      const metricsData: MetricsData = { ...data, isStale: false }
      this.cache = metricsData
      return metricsData
    } catch (error) {
      console.error("Error fetching metrics:", error)

      // Return cached data if available
      if (this.cache) {
        return { ...this.cache, isStale: true }
      }

      // Return empty metrics if no cache
      return {
        tokens: { input: 0, output: 0, total: 0 },
        memory: { eventCount: 0, error: true },
        lastUpdated: new Date().toISOString(),
        isStale: true,
      }
    }
  }

  /**
   * Fetch available agents from the backend
   *
   * @param idToken - Cognito ID token for authentication
   * @returns Promise with agents list
   */
  async fetchAgents(idToken: string): Promise<Agent[]> {
    const apiUrl = await loadApiUrl()
    const url = `${apiUrl}agents`

    try {
      const data: AgentsResponse = await this.retryWithBackoff(async () => {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        return await response.json()
      })

      return data.agents || []
    } catch (error) {
      console.error("Error fetching agents:", error)
      return []
    }
  }

  /**
   * Fetch available tools from the backend
   *
   * @param idToken - Cognito ID token for authentication
   * @returns Promise with tools list
   */
  async fetchTools(idToken: string): Promise<Tool[]> {
    const apiUrl = await loadApiUrl()
    const url = `${apiUrl}tools`

    try {
      const data: ToolsResponse = await this.retryWithBackoff(async () => {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        return await response.json()
      })

      return data.tools || []
    } catch (error) {
      console.error("Error fetching tools:", error)
      return []
    }
  }

  /**
   * Retry a function with exponential backoff
   *
   * @param fn - Async function to retry
   * @param attempt - Current attempt number (starts at 1)
   * @returns Promise with function result
   */
  private async retryWithBackoff<T>(fn: () => Promise<T>, attempt: number = 1): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= this.retryConfig.maxAttempts) {
        throw error
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        this.retryConfig.baseDelay * Math.pow(2, attempt - 1),
        this.retryConfig.maxDelay
      )

      console.log(`Retry attempt ${attempt} after ${delay}ms`)

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay))

      // Retry
      return this.retryWithBackoff(fn, attempt + 1)
    }
  }

  /**
   * Clear cached metrics
   */
  clearCache(): void {
    this.cache = null
  }
}

// Export singleton instance
export const metricsService = new MetricsService()
