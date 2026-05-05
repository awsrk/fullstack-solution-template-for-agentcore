"use client"
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react"
import ChatInterface from "@/components/chat/ChatInterface"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { GlobalContextProvider } from "@/app/context/GlobalContext"
import { LearnNav, type LearnSection } from "@/components/learn/LearnNav"
import { OverviewPage } from "@/components/learn/OverviewPage"
import { ArchitecturePage } from "@/components/learn/ArchitecturePage"
import { RuntimePage } from "@/components/learn/RuntimePage"
import { MemoryPage } from "@/components/learn/MemoryPage"
import { GatewayPage } from "@/components/learn/GatewayPage"

function LearnContent({ section }: { section: LearnSection }) {
  switch (section) {
    case "overview":
      return <OverviewPage />
    case "architecture":
      return <ArchitecturePage />
    case "runtime":
      return <RuntimePage />
    case "memory":
      return <MemoryPage />
    case "gateway":
      return <GatewayPage />
    default:
      return null
  }
}

export default function ChatPage() {
  const { isAuthenticated, signIn } = useAuth()
  const [activeSection, setActiveSection] = useState<LearnSection>("chat")

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-4xl">Please sign in</p>
        <Button onClick={() => signIn()}>Sign In</Button>
      </div>
    )
  }

  return (
    <GlobalContextProvider>
      <div className="flex h-screen w-full overflow-hidden">
        <LearnNav active={activeSection} onChange={setActiveSection} />

        <div className="flex-1 overflow-hidden">
          {activeSection === "chat" ? (
            <ChatInterface />
          ) : (
            <div className="h-full overflow-y-auto">
              <LearnContent section={activeSection} />
            </div>
          )}
        </div>
      </div>
    </GlobalContextProvider>
  )
}
