"""Market data Gateway tool Lambda — live stock prices and financial news via AgentCore Browser."""

import json
import logging
import os
import time
import urllib.parse

import boto3
from bedrock_agentcore.tools.browser_client import browser_session
from playwright.sync_api import sync_playwright

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")

_NEWS_URLS = {
    "bloomberg": "https://www.bloomberg.com/search?query={q}",
    "reuters": "https://www.reuters.com/site-search/?query={q}",
    "cnbc": "https://www.cnbc.com/search/?query={q}",
    "wsj": "https://www.wsj.com/search?query={q}",
    "wall street journal": "https://www.wsj.com/search?query={q}",
    "financial times": "https://www.ft.com/search?q={q}",
    "ft": "https://www.ft.com/search?q={q}",
    "yahoo finance": "https://finance.yahoo.com/news/",
    "yahoo": "https://finance.yahoo.com/news/",
    "marketwatch": "https://www.marketwatch.com/search?q={q}",
    "seeking alpha": "https://seekingalpha.com/search?q={q}",
}

_NEWS_FALLBACKS = {
    "reuters": "https://www.reuters.com/markets/",
    "bloomberg": "https://www.bloomberg.com/markets",
    "cnbc": "https://www.cnbc.com/business/",
    "wsj": "https://www.wsj.com/business",
    "financial times": "https://www.ft.com/markets",
    "yahoo finance": "https://finance.yahoo.com/news/",
    "yahoo": "https://finance.yahoo.com/news/",
    "marketwatch": "https://www.marketwatch.com/markets",
    "seeking alpha": "https://seekingalpha.com/market-news",
}

_ERROR_INDICATORS = [
    "can't find that page", "page not found", "404", "503",
    "backend fetch failed", "service unavailable", "access denied",
    "blocked", "rate limit",
]


def _invoke_haiku(prompt: str) -> str:
    client = boto3.client("bedrock-runtime", region_name=AWS_REGION)
    response = client.converse(
        modelId="us.anthropic.claude-haiku-4-5-20251001-v1:0",
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": 1024},
    )
    return response["output"]["message"]["content"][0]["text"]


def get_stock_data(symbol: str) -> str:
    with sync_playwright() as p:
        with browser_session(AWS_REGION) as client:
            ws_url, headers = client.generate_ws_headers()
            browser = p.chromium.connect_over_cdp(ws_url, headers=headers)
            try:
                ctx = browser.contexts[0] if browser.contexts else browser.new_context()
                page = ctx.pages[0] if ctx.pages else ctx.new_page()
                page.goto(f"https://finance.yahoo.com/quote/{symbol}")
                time.sleep(2)
                content = page.inner_text("body")
                return _invoke_haiku(
                    f"Extract stock price and key information for {symbol} from this page content. "
                    f"Be concise:\n\n{content[:3000]}"
                )
            finally:
                if not page.is_closed():
                    page.close()
                browser.close()


def search_news(query: str, news_source: str = "bloomberg") -> str:
    with sync_playwright() as p:
        with browser_session(AWS_REGION) as client:
            ws_url, headers = client.generate_ws_headers()
            browser = p.chromium.connect_over_cdp(ws_url, headers=headers)
            try:
                ctx = (
                    browser.contexts[0]
                    if browser.contexts
                    else browser.new_context(
                        user_agent=(
                            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                        )
                    )
                )
                page = ctx.pages[0] if ctx.pages else ctx.new_page()
                encoded_q = urllib.parse.quote_plus(query)
                source_key = news_source.lower()
                url = _NEWS_URLS.get(source_key, "https://www.bloomberg.com/search?query={q}").format(q=encoded_q)

                content = None
                for attempt in range(2):
                    try:
                        page.goto(url, timeout=15000)
                        time.sleep(3 + attempt)
                        content = page.inner_text("body")
                        if any(ind in content.lower() for ind in _ERROR_INDICATORS):
                            if attempt == 0:
                                continue
                            raise RuntimeError("Error page after retries")
                        break
                    except Exception:
                        if attempt == 0:
                            time.sleep(2)
                            continue
                        fallback_url = _NEWS_FALLBACKS.get(source_key)
                        if fallback_url:
                            page.goto(fallback_url, timeout=15000)
                            time.sleep(3)
                            content = page.inner_text("body")
                        else:
                            raise

                is_search = "search" in url or encoded_q in url
                prompt = (
                    f"Extract the main news headlines and key highlights about '{query}' "
                    f"from this {news_source} search page. Focus on financial and market-relevant news:\n\n{content[:4000]}"
                    if is_search else
                    f"Extract recent market news headlines and highlights from this {news_source} "
                    f"markets page, focusing on topics related to '{query}' if available:\n\n{content[:4000]}"
                )
                return _invoke_haiku(prompt)
            finally:
                if not page.is_closed():
                    page.close()
                browser.close()


def handler(event, context):
    logger.info(f"Event: {json.dumps(event)}")
    try:
        delimiter = "___"
        raw = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = raw[raw.index(delimiter) + len(delimiter):]

        if tool_name == "get_stock_data":
            symbol = event.get("symbol", "")
            if not symbol:
                return {"error": "symbol is required"}
            result = get_stock_data(symbol)
            return {"content": [{"type": "text", "text": result}]}

        elif tool_name == "search_news":
            query = event.get("query", "")
            if not query:
                return {"error": "query is required"}
            news_source = event.get("news_source", "bloomberg")
            result = search_news(query, news_source)
            return {"content": [{"type": "text", "text": result}]}

        else:
            return {"error": f"Unknown tool: {tool_name}"}

    except Exception as e:
        logger.error(f"Error: {e}")
        return {"error": f"Internal server error: {str(e)}"}
