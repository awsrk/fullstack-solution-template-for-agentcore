"""Broker card Gateway tool Lambda — profile parsing and tailored market summaries."""

import json
import logging
import os
from typing import Dict

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")


def _invoke_haiku(prompt: str, max_tokens: int = 2048) -> str:
    client = boto3.client("bedrock-runtime", region_name=AWS_REGION)
    response = client.converse(
        modelId="us.anthropic.claude-haiku-4-5-20251001-v1:0",
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": max_tokens},
    )
    return response["output"]["message"]["content"][0]["text"]


def _parse_broker_card(card_content: str) -> Dict[str, str]:
    fields: Dict[str, str] = {
        "name": "", "company": "", "role": "",
        "preferred_news_feed": "", "industry_interests": "",
        "investment_strategy": "", "risk_tolerance": "",
        "client_demographics": "", "geographic_focus": "",
        "recent_interests": "", "additional_notes": "",
    }
    mapping = {
        "Name:": "name", "Company:": "company", "Role:": "role",
        "Preferred News Feed:": "preferred_news_feed",
        "Industry Interests:": "industry_interests",
        "Investment Strategy:": "investment_strategy",
        "Risk Tolerance:": "risk_tolerance",
        "Client Demographics:": "client_demographics",
        "Geographic Focus:": "geographic_focus",
        "Recent Interests:": "recent_interests",
        "Additional Notes:": "additional_notes",
    }
    for line in card_content.split("\n"):
        line = line.strip()
        for prefix, key in mapping.items():
            if line.startswith(prefix):
                fields[key] = line[len(prefix):].strip()
                break
    return fields


def parse_broker_profile_from_message(user_message: str) -> str:
    card_fields = ["Name:", "Company:", "Role:", "Industry Interests:"]
    if not any(f in user_message for f in card_fields):
        return "Message does not contain broker card format"
    data = _parse_broker_card(user_message)
    lines = [
        f"{label}: {data[key]}"
        for label, key in [
            ("Name", "name"), ("Company", "company"), ("Role", "role"),
            ("Preferred News Feed", "preferred_news_feed"),
            ("Industry Interests", "industry_interests"),
            ("Investment Strategy", "investment_strategy"),
            ("Risk Tolerance", "risk_tolerance"),
            ("Client Demographics", "client_demographics"),
            ("Geographic Focus", "geographic_focus"),
            ("Recent Interests", "recent_interests"),
        ]
        if data[key]
    ]
    if lines:
        return "Broker Profile Detected:\n" + "\n".join(lines)
    return "No structured broker profile found in message"


def generate_market_summary_for_broker(broker_profile: str, market_data: str = "") -> str:
    prompt = f"""Generate a comprehensive market trends summary tailored for this broker profile:

{broker_profile}

Please provide a structured summary covering:

1. LATEST IMPORTANT NEWS — focus on sectors in their industry interests
2. MAJOR STOCK MOVEMENTS — stocks in their industries of interest, % changes and drivers
3. INDEXES RECAP — S&P 500, NASDAQ, Dow Jones, relevant sector indexes
4. MAJOR IPOs AND ACQUISITIONS — in relevant sectors
5. LEGAL OR POLITICAL EVENTS — regulatory changes affecting their focus industries

Additional market data to consider:
{market_data}

Format as a professional market briefing suitable for this broker's profile and client base."""
    return _invoke_haiku(prompt, max_tokens=2048)


def get_broker_card_template() -> str:
    return """BROKER CARD TEMPLATE:
Please provide your information in this format:

Name: [Your Full Name]
Company: [Your Company/Firm]
Role: [Your Role/Title]
Preferred News Feed: [Bloomberg, WSJ, Reuters, etc.]
Industry Interests: [technology, healthcare, energy, etc.]
Investment Strategy: [growth, value, dividend, etc.]
Risk Tolerance: [conservative, moderate, aggressive]
Client Demographics: [retail, institutional, high net worth, etc.]
Geographic Focus: [North America, Europe, Asia-Pacific, etc.]
Recent Interests: [specific sectors, trends, or companies]

Example:
Name: Sarah Chen
Company: Morgan Stanley
Role: Investment Advisor
Preferred News Feed: Bloomberg
Industry Interests: technology, healthcare, financial services
Investment Strategy: growth investing
Risk Tolerance: moderate to high
Client Demographics: younger professionals, tech workers
Geographic Focus: North America, Asia-Pacific
Recent Interests: artificial intelligence, renewable energy, fintech"""


def collect_broker_preferences_interactively(preference_type: str) -> str:
    questions = {
        "industries": "What industries or sectors are you most interested in? (e.g., technology, healthcare, energy, financial services)",
        "risk": "What's your typical risk tolerance? (conservative, moderate, or aggressive)",
        "strategy": "What investment strategy do you typically follow? (growth, value, dividend, momentum, etc.)",
        "news": "What's your preferred news source for market information? (Bloomberg, WSJ, Reuters, Financial Times, etc.)",
        "clients": "What type of clients do you primarily serve? (retail investors, institutional, high net worth, etc.)",
        "geography": "What geographic regions do you focus on? (North America, Europe, Asia-Pacific, emerging markets, etc.)",
        "recent": "Are there any specific companies, trends, or sectors you're particularly interested in right now?",
    }
    return questions.get(
        preference_type.lower(),
        "Please tell me more about your investment preferences and areas of focus.",
    )


TOOLS = {
    "parse_broker_profile_from_message": parse_broker_profile_from_message,
    "generate_market_summary_for_broker": generate_market_summary_for_broker,
    "get_broker_card_template": get_broker_card_template,
    "collect_broker_preferences_interactively": collect_broker_preferences_interactively,
}


def handler(event, context):
    logger.info(f"Event: {json.dumps(event)}")
    try:
        delimiter = "___"
        raw = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = raw[raw.index(delimiter) + len(delimiter):]

        if tool_name == "parse_broker_profile_from_message":
            result = parse_broker_profile_from_message(event.get("user_message", ""))
        elif tool_name == "generate_market_summary_for_broker":
            result = generate_market_summary_for_broker(
                event.get("broker_profile", ""),
                event.get("market_data", ""),
            )
        elif tool_name == "get_broker_card_template":
            result = get_broker_card_template()
        elif tool_name == "collect_broker_preferences_interactively":
            result = collect_broker_preferences_interactively(event.get("preference_type", ""))
        else:
            return {"error": f"Unknown tool: {tool_name}"}

        return {"content": [{"type": "text", "text": result}]}

    except Exception as e:
        logger.error(f"Error: {e}")
        return {"error": f"Internal server error: {str(e)}"}
