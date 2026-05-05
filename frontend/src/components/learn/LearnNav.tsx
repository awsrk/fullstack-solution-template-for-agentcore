import { MessageSquare, BookOpen, Cpu, Brain, Network, Wrench } from "lucide-react"
import { cn } from "@/lib/utils"

export type LearnSection =
  | "chat"
  | "overview"
  | "architecture"
  | "runtime"
  | "memory"
  | "gateway"

interface NavItem {
  id: LearnSection
  label: string
  icon: React.ComponentType<{ className?: string }>
  group?: string
}

const NAV_ITEMS: NavItem[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "overview", label: "What is AgentCore?", icon: BookOpen, group: "Learn AgentCore" },
  { id: "architecture", label: "Architecture", icon: Network, group: "Learn AgentCore" },
  { id: "runtime", label: "Runtime", icon: Cpu, group: "Learn AgentCore" },
  { id: "memory", label: "Memory", icon: Brain, group: "Learn AgentCore" },
  { id: "gateway", label: "Gateway & Tools", icon: Wrench, group: "Learn AgentCore" },
]

interface LearnNavProps {
  active: LearnSection
  onChange: (section: LearnSection) => void
}

export function LearnNav({ active, onChange }: LearnNavProps) {
  let lastGroup: string | undefined

  return (
    <nav className="flex flex-col h-full w-56 border-r bg-gray-50 py-4 flex-none">
      <div className="px-4 mb-4">
        <span className="text-xs font-semibold tracking-widest text-gray-400 uppercase">FAST</span>
      </div>

      {NAV_ITEMS.map(item => {
        const showGroupLabel = item.group && item.group !== lastGroup
        if (item.group) lastGroup = item.group

        return (
          <div key={item.id}>
            {showGroupLabel && (
              <div className="px-4 pt-4 pb-1">
                <span className="text-xs font-semibold tracking-widest text-gray-400 uppercase">
                  {item.group}
                </span>
              </div>
            )}
            <button
              onClick={() => onChange(item.id)}
              className={cn(
                "flex items-center gap-3 w-full px-4 py-2.5 text-sm text-left transition-colors",
                active === item.id
                  ? "bg-white border-r-2 border-orange-500 text-orange-700 font-medium"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              <item.icon className={cn("h-4 w-4 flex-none", active === item.id ? "text-orange-500" : "text-gray-400")} />
              {item.label}
            </button>
          </div>
        )
      })}

      <div className="mt-auto px-4 py-3 border-t">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-orange-500" />
          <span className="text-xs text-gray-500">Amazon Bedrock AgentCore</span>
        </div>
      </div>
    </nav>
  )
}
