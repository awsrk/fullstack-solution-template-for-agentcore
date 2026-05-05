"""Market trends Strands agent — all tools served via AgentCore Gateway."""

import json
import logging
import os

from bedrock_agentcore.memory.integrations.strands.config import (
    AgentCoreMemoryConfig,
    RetrievalConfig,
)
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from strands import Agent
from strands.models import BedrockModel
from tools.code_interpreter import StrandsCodeInterpreterTools
from tools.gateway import create_gateway_mcp_client
from utils.auth import extract_user_id_from_context

logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()

_SYSTEM_PROMPT_TEMPLATE = """You are an expert market intelligence analyst with deep expertise in financial markets, business strategy, and economic trends. You have advanced long-term memory capabilities to store and recall financial interests for each broker you work with.

CURRENT SESSION ID: {session_id}
Pass this session_id value whenever a broker memory tool requires it.

PURPOSE:
- Provide real-time market analysis and stock data
- Maintain long-term financial profiles for each broker/client
- Store and recall investment preferences, risk tolerance, and financial goals
- Deliver personalised investment insights based on stored broker profiles

AVAILABLE TOOLS (via Gateway):

Real-Time Market Data:
- gateway_get_stock_data(symbol): Live stock prices, daily change, and key market data
- gateway_search_news(query, news_source): Headlines from Bloomberg, Reuters, CNBC, WSJ, Financial Times, Yahoo Finance, MarketWatch, Seeking Alpha

Broker Profile Collection:
- gateway_parse_broker_profile_from_message(user_message): Parse structured broker card
- gateway_generate_market_summary_for_broker(broker_profile, market_data): Tailored market briefing
- gateway_get_broker_card_template(): Standard broker card template
- gateway_collect_broker_preferences_interactively(preference_type): Collect missing preferences

Broker Memory — always call identify_broker FIRST, then pass the returned actor_id:
- gateway_identify_broker(user_message): Extract actor_id — CALL THIS FIRST
- gateway_get_broker_financial_profile(actor_id, session_id): Retrieve stored investment profile
- gateway_update_broker_financial_interests(interests_update, actor_id, session_id): Persist new profile info
- gateway_list_conversation_history(actor_id, session_id): Recent conversation history

Code Interpreter: Execute Python for data analysis, charting, or calculations.

MANDATORY BROKER IDENTIFICATION WORKFLOW:
1. If ANY user message contains names, introductions, company names, roles, or broker card fields:
   → IMMEDIATELY call gateway_identify_broker(user_message) as your FIRST action
   → Use the returned actor_id AND the session_id above for ALL subsequent memory tool calls
2. Returning broker: call gateway_get_broker_financial_profile and personalise the response
3. New broker: collect profile via broker card tools, then store with gateway_update_broker_financial_interests
4. Anonymous market question: skip identification and answer directly

PROFESSIONAL STANDARDS:
- Deliver institutional-quality analysis tailored to each broker's stored risk tolerance
- Reference their specific investment goals and time horizons from their profile
- Provide recommendations aligned with their stored investment style"""


def _create_session_manager(user_id: str, session_id: str) -> AgentCoreMemorySessionManager:
    memory_id = os.environ.get("MEMORY_ID")
    if not memory_id:
        raise ValueError("MEMORY_ID environment variable is required")

    use_ltm = os.environ.get("USE_LONG_TERM_MEMORY", "false").lower() == "true"
    top_k = int(os.environ.get("LTM_TOP_K", "10"))
    relevance_score = float(os.environ.get("LTM_RELEVANCE_SCORE", "0.3"))

    retrieval_config = (
        {
            "/facts/{actorId}": RetrievalConfig(
                top_k=top_k,
                relevance_score=relevance_score,
            )
        }
        if use_ltm
        else None
    )

    config = AgentCoreMemoryConfig(
        memory_id=memory_id,
        session_id=session_id,
        actor_id=user_id,
        retrieval_config=retrieval_config,
    )
    return AgentCoreMemorySessionManager(
        agentcore_memory_config=config,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    )


def create_market_trends_agent(user_id: str, session_id: str) -> Agent:
    bedrock_model = BedrockModel(
        model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0", temperature=0.1
    )

    session_manager = _create_session_manager(user_id, session_id)

    region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    code_tools = StrandsCodeInterpreterTools(region)
    gateway_client = create_gateway_mcp_client()

    return Agent(
        name="market_trends_agent",
        system_prompt=_SYSTEM_PROMPT_TEMPLATE.format(session_id=session_id),
        tools=[gateway_client, code_tools.execute_python_securely],
        model=bedrock_model,
        session_manager=session_manager,
        trace_attributes={"user.id": user_id, "session.id": session_id},
    )


@app.entrypoint
async def invocations(payload, context: RequestContext):
    user_query = payload.get("prompt")
    session_id = payload.get("runtimeSessionId")

    if not all([user_query, session_id]):
        yield {
            "status": "error",
            "error": "Missing required fields: prompt or runtimeSessionId",
        }
        return

    if user_query == "warmup":
        yield {"status": "warmup"}
        return

    try:
        user_id = extract_user_id_from_context(context)
        agent = create_market_trends_agent(user_id, session_id)

        async for event in agent.stream_async(user_query):
            yield json.loads(json.dumps(dict(event), default=str))

    except Exception as e:
        logger.exception("Agent run failed")
        yield {"status": "error", "error": str(e)}


if __name__ == "__main__":
    app.run()
