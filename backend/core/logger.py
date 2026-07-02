import json
import datetime
from pathlib import Path
from typing import List, Optional
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

# Base logs path
LOGS_DIR = Path(__file__).parent.parent.absolute() / "logs"
TRACE_FILE_PATH = LOGS_DIR / "agent_trace.json"

# Price per 1,000,000 tokens (USD)
PRICING_TABLE = {
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "meta/llama-3.3-70b-instruct": {"input": 0.00, "output": 0.00},  # NVIDIA NIM Free Tier Default
    "meta/llama-3.1-405b-instruct": {"input": 0.00, "output": 0.00},
    "qwen2.5-coder-thesis:latest": {"input": 0.00, "output": 0.00},  # Ollama Local
}

def calculate_token_cost(model_name: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Calculate the estimated cost of LLM invocation in USD."""
    # Handle direct model mappings or defaults
    matched_model = None
    for k in PRICING_TABLE.keys():
        if k in model_name.lower():
            matched_model = k
            break
            
    if not matched_model:
        # Fallbacks based on typical families
        if "gpt-4o-mini" in model_name.lower():
            matched_model = "gpt-4o-mini"
        elif "gpt-4o" in model_name.lower():
            matched_model = "gpt-4o"
        else:
            return 0.0
            
    rates = PRICING_TABLE[matched_model]
    prompt_cost = (prompt_tokens / 1_000_000.0) * rates["input"]
    completion_cost = (completion_tokens / 1_000_000.0) * rates["output"]
    return prompt_cost + completion_cost

class TokenUsageCallbackHandler(BaseCallbackHandler):
    """Callback handler to track token usage and write it into the PostgreSQL database."""
    def __init__(self, session_id: str, node_name: str):
        super().__init__()
        self.session_id = session_id
        self.node_name = node_name

    def on_llm_end(self, response: LLMResult, **kwargs) -> None:
        try:
            # Safely parse token metadata
            for generation_list in response.generations:
                for generation in generation_list:
                    metadata = generation.generation_info or {}
                    token_usage = metadata.get("token_usage") or {}
                    
                    if not token_usage and response.llm_output:
                        token_usage = response.llm_output.get("token_usage") or {}
                        
                    if token_usage:
                        prompt_tokens = token_usage.get("prompt_tokens", 0)
                        completion_tokens = token_usage.get("completion_tokens", 0)
                        model_name = response.llm_output.get("model_name", "unknown") if response.llm_output else "unknown"
                        
                        # Calculate cost
                        cost = calculate_token_cost(model_name, prompt_tokens, completion_tokens)
                        
                        # Write to PostgreSQL DB
                        from core.database import get_db_connection
                        with get_db_connection() as conn:
                            with conn.cursor() as cur:
                                cur.execute(
                                    "INSERT INTO token_usage (session_id, node_name, model_name, prompt_tokens, completion_tokens, cost) VALUES (%s, %s, %s, %s, %s, %s)",
                                    (self.session_id, self.node_name, model_name, prompt_tokens, completion_tokens, cost)
                                )
                        print(f"[Telemetry] Logged token usage to DB for {self.node_name}: {prompt_tokens} prompt, {completion_tokens} completion. Cost: ${cost:.6f}")
                        return
        except Exception as e:
            print(f"[Telemetry Error] Failed to log token usage: {str(e)}")


def write_agent_trace(
    thread_id: str,
    message: str,
    steps: List[dict],
    final_answer: str,
    chart_url: Optional[str] = None
):
    """
    Appends a new trace record to backend/logs/agent_trace.json.
    Creates parent directories and the file if they do not exist.
    """
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    
    # Query database to aggregate token usage and cost for this thread
    token_usage_list = []
    total_cost = 0.0
    try:
        from core.database import get_db_connection
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT node_name, model_name, prompt_tokens, completion_tokens, cost, created_at FROM token_usage WHERE session_id = %s",
                    (thread_id,)
                )
                rows = cur.fetchall()
                for r in rows:
                    total_cost += float(r[4])
                    token_usage_list.append({
                        "node_name": r[0],
                        "model_name": r[1],
                        "prompt_tokens": r[2],
                        "completion_tokens": r[3],
                        "cost": float(r[4]),
                        "created_at": r[5].isoformat()
                    })
    except Exception as db_err:
        print(f"[Logger Warning] Could not fetch token usage stats for trace: {db_err}")

    new_trace = {
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "thread_id": thread_id,
        "message": message,
        "steps": steps,
        "final_answer": final_answer,
        "chart_url": chart_url,
        "token_usage": token_usage_list,
        "total_cost": total_cost
    }
    
    traces = []
    if TRACE_FILE_PATH.exists():
        try:
            with open(TRACE_FILE_PATH, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if content:
                    traces = json.loads(content)
                    if not isinstance(traces, list):
                        traces = []
        except Exception:
            # Fallback if corrupt
            traces = []
            
    traces.append(new_trace)
    
    try:
        with open(TRACE_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(traces, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Logger Error] Failed to write agent trace: {str(e)}")

