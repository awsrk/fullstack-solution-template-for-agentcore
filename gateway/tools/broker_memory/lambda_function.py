"""Broker memory Gateway tool Lambda — persistent financial profiles via AgentCore Memory."""

import hashlib
import json
import logging
import os
import re

import boto3
from bedrock_agentcore.memory import MemoryClient

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
MEMORY_ID = os.environ.get("MEMORY_ID", "")

_memory_client: MemoryClient | None = None


def _get_client() -> MemoryClient:
    global _memory_client
    if _memory_client is None:
        _memory_client = MemoryClient(region_name=AWS_REGION)
    return _memory_client


def _extract_actor_id(user_message: str) -> str:
    name_match = re.search(r"Name:\s*([^\n]+)", user_message, re.IGNORECASE)
    if name_match:
        name = name_match.group(1).strip()
        if name and name.lower() != "unknown":
            return "broker_" + re.sub(r"[^a-zA-Z0-9]", "_", name.lower())
    for pattern in [
        r"I'?m\s+([A-Z][a-zA-Z\s]+?)(?:\s+from|\s+at|\s*[,.]|$)",
        r"My name is\s+([A-Z][a-zA-Z\s]+?)(?:\s+from|\s+at|\s*[,.]|$)",
        r"This is\s+([A-Z][a-zA-Z\s]+?)(?:\s+from|\s+at|\s*[,.]|$)",
    ]:
        m = re.search(pattern, user_message, re.IGNORECASE)
        if m:
            name = m.group(1).strip()
            if len(name.split()) <= 3:
                return "broker_" + re.sub(r"[^a-zA-Z0-9]", "_", name.lower())
    return "user_" + hashlib.sha256(user_message.lower().encode()).hexdigest()[:8]


def _get_namespaces() -> dict:
    try:
        strategies = _get_client().get_memory_strategies(MEMORY_ID)
        return {s["type"]: s["namespaces"][0] for s in strategies}
    except Exception as e:
        logger.error(f"Error fetching namespaces: {e}")
        return {}


def identify_broker(user_message: str) -> str:
    actor_id = _extract_actor_id(user_message)
    namespaces = _get_namespaces()
    found = False
    for strategy_type, ns_template in namespaces.items():
        try:
            ns = ns_template.format(actorId=actor_id)
            mems = _get_client().retrieve_memories(
                memory_id=MEMORY_ID,
                namespace=ns,
                query="broker profile investment preferences",
                top_k=1,
            )
            if mems:
                found = True
                break
        except Exception:
            continue
    status = "Existing broker found" if found else "New broker"
    action = (
        f"Use get_broker_financial_profile with actor_id='{actor_id}' to retrieve their stored preferences."
        if found
        else f"Use update_broker_financial_interests with actor_id='{actor_id}' to store their preferences."
    )
    return f"ACTOR_ID: {actor_id}\nSTATUS: {status}\nACTION: {action}"


def get_broker_financial_profile(actor_id: str, session_id: str) -> str:
    if not actor_id:
        return "No actor_id provided. Call identify_broker first."
    namespaces = _get_namespaces()
    profile_parts = []
    for strategy_type, ns_template in namespaces.items():
        try:
            ns = ns_template.format(actorId=actor_id)
            mems = _get_client().retrieve_memories(
                memory_id=MEMORY_ID,
                namespace=ns,
                query="broker financial profile investment preferences risk tolerance",
                top_k=3,
            )
            for mem in mems:
                if isinstance(mem, dict):
                    text = (mem.get("content") or {}).get("text", "").strip()
                    if text and len(text) > 20:
                        profile_parts.append(f"[{strategy_type.upper()}] {text}")
        except Exception as e:
            logger.debug(f"No memories in strategy {strategy_type}: {e}")
    if profile_parts:
        return "Broker Financial Profile:\n" + "\n\n".join(profile_parts)
    # Fallback to event history
    events = _get_client().list_events(
        memory_id=MEMORY_ID, actor_id=actor_id, session_id=session_id, max_results=10,
    )
    keywords = {"broker", "investment", "risk tolerance", "portfolio", "preference", "client"}
    snippets = []
    for event in events or []:
        for msg in event.get("messages", []):
            content = msg.get("content", "")
            if any(kw in content.lower() for kw in keywords) and len(content) > 50:
                snippets.append(content[:200] + ("..." if len(content) > 200 else ""))
    if snippets:
        return "Broker Profile (from conversation history):\n" + "\n\n".join(snippets[-2:])
    return "No financial profile found for this broker yet."


def update_broker_financial_interests(interests_update: str, actor_id: str, session_id: str) -> str:
    if not actor_id:
        return "No actor_id provided. Call identify_broker first."
    _get_client().create_event(
        memory_id=MEMORY_ID,
        actor_id=actor_id,
        session_id=session_id,
        messages=[
            (f"Please update my financial profile with this information: {interests_update}", "USER"),
            ("I've updated your financial profile with the new information.", "ASSISTANT"),
        ],
    )
    return "Financial interests successfully updated in long-term memory profile."


def list_conversation_history(actor_id: str, session_id: str) -> str:
    if not actor_id:
        return "No actor_id provided. Call identify_broker first."
    events = _get_client().list_events(
        memory_id=MEMORY_ID, actor_id=actor_id, session_id=session_id, max_results=10,
    )
    if not events:
        return "No conversation history available."
    lines = []
    for event in events[-5:]:
        for msg in event.get("messages", []):
            content = msg.get("content", "").strip()
            role = msg.get("role", "unknown")
            if content:
                lines.append(f"{role.upper()}: {content[:100]}...")
    return ("Recent conversation history:\n" + "\n".join(lines)) if lines else "No meaningful conversation history found."


def handler(event, context):
    logger.info(f"Event: {json.dumps(event)}")
    try:
        delimiter = "___"
        raw = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = raw[raw.index(delimiter) + len(delimiter):]

        if tool_name == "identify_broker":
            result = identify_broker(event.get("user_message", ""))

        elif tool_name == "get_broker_financial_profile":
            result = get_broker_financial_profile(
                event.get("actor_id", ""),
                event.get("session_id", ""),
            )

        elif tool_name == "update_broker_financial_interests":
            result = update_broker_financial_interests(
                event.get("interests_update", ""),
                event.get("actor_id", ""),
                event.get("session_id", ""),
            )

        elif tool_name == "list_conversation_history":
            result = list_conversation_history(
                event.get("actor_id", ""),
                event.get("session_id", ""),
            )

        else:
            return {"error": f"Unknown tool: {tool_name}"}

        return {"content": [{"type": "text", "text": result}]}

    except Exception as e:
        logger.error(f"Error: {e}")
        return {"error": f"Internal server error: {str(e)}"}
