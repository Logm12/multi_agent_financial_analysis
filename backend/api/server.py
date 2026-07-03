import os
import json
from typing import Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_core.messages import HumanMessage
from sse_starlette.sse import EventSourceResponse

from agents.graph import get_graph_app, get_async_graph_app
from core.config import DATA_DIR, TEMP_DIR, REDIS_URL
from core.database import init_db
from api.auth import router as auth_router, get_current_user
import redis

from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse

from api.routes import router as routes_router
from api.document import router as document_router
import re

def extract_chart_data(execution_result: str) -> Optional[list]:
    """DataFrame-to-JSON parser: extracts a JSON list from execution stdout."""
    if not execution_result:
        return None
    # 1. Search for data wrapped inside <json_data>...</json_data>
    match = re.search(r"<json_data>(.*?)</json_data>", execution_result, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except Exception:
            pass
    # 2. Fallback: Search for a raw JSON array structure
    match_fallback = re.search(r"\[\s*\{.*\}\s*\]", execution_result, re.DOTALL)
    if match_fallback:
        try:
            return json.loads(match_fallback.group(0).strip())
        except Exception:
            pass
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB schema on startup
    init_db()
    yield

app = FastAPI(title="Financial Analyzer API", lifespan=lifespan)

# Port resolution for Docker vs Local
DB_HOST = os.getenv("POSTGRES_HOST", "localhost")
DB_PORT = os.getenv("POSTGRES_PORT", "5433")

# CORS mapping
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://frontend-rust-nu-86.vercel.app"
    ],
    allow_origin_regex="https://.*\\.vercel\\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from api.trace_api import router as trace_router

app.include_router(auth_router)
app.include_router(routes_router)
app.include_router(document_router)
app.include_router(trace_router)

RAW_DATA_DIR = DATA_DIR / "raw"
RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)

class ChatRequest(BaseModel):
    message: str
    thread_id: str
    session_id: Optional[str] = "default"

@app.get("/chart/{thread_id}")
async def get_chart(thread_id: str):
    """
    Endpoint serving chart.png generated for a specific thread.
    """
    # 1. Check persistent charts directory
    persistent_path = DATA_DIR / "charts" / f"{thread_id}.png"
    if os.path.exists(persistent_path):
        return FileResponse(str(persistent_path), media_type="image/png")

    # 2. Fallback to temp directory
    chart_path = TEMP_DIR / thread_id / "chart.png"
    if os.path.exists(chart_path):
        return FileResponse(str(chart_path), media_type="image/png")
        
    raise HTTPException(status_code=404, detail="Chart not found for this session")

def persist_chart(src_path: str, dest_id: str):
    import shutil
    if src_path and os.path.exists(src_path):
        try:
            charts_dir = DATA_DIR / "charts"
            charts_dir.mkdir(parents=True, exist_ok=True)
            dest_path = charts_dir / f"{dest_id}.png"
            shutil.copy2(src_path, dest_path)
            print(f"[Chart] Successfully persisted chart to {dest_path}")
        except Exception as e:
            print(f"[Chart Warning] Failed to persist chart: {e}")

@app.get("/chat-stream")
async def chat_stream(
    message: str, 
    thread_id: str, 
    ground_truth: Optional[str] = None, 
    current_user: dict = Depends(get_current_user)
):
    """
    SSE endpoint to stream results from LangGraph.
    """
    scoped_thread_id = f"{current_user['id']}_{thread_id}"
    
    async def event_generator():
        inputs = {
            "messages": [HumanMessage(content=message)],
            "steps": [],
            "ground_truth": ground_truth
        }

        config = {
            "configurable": {
                "thread_id": scoped_thread_id, 
                "session_tmp_dir": str(TEMP_DIR / scoped_thread_id),
                "user_id": current_user["id"]
            }
        }
        
        # Ensure thread tmp dir exists
        (TEMP_DIR / scoped_thread_id).mkdir(parents=True, exist_ok=True)

        try:
            active_chart_path = None # Track accumulated chart path in this session
            active_chart_data = None
            trace_steps = []
            async with get_async_graph_app() as graph_app:
                async for output in graph_app.astream(inputs, config=config):
                    for node, values in output.items():
                        # Accumulate chart path if any node produced it (e.g., coder)
                        if "chart_path" in values and values["chart_path"]:
                            active_chart_path = values["chart_path"]
                        if "execution_result" in values and values["execution_result"]:
                            parsed = extract_chart_data(values["execution_result"])
                            if parsed:
                                active_chart_data = parsed
                        
                        # Send node status (Thought Process)
                        step_msg = values["steps"][-1] if values.get("steps") else f"Executing {node}..."
                        trace_steps.append({"node": node, "output": step_msg})
                        yield {
                            "event": "step",
                            "data": json.dumps({"node": node, "output": step_msg})
                        }
                        
                        # If it is the final node or has a final_answer
                        if "final_answer" in values:
                            clean_answer = values["final_answer"].replace("[CHART_01_RENDERED]", "").strip()
                            if active_chart_path:
                                persist_chart(active_chart_path, scoped_thread_id)
                            chart_url = f"/chart/{scoped_thread_id}" if active_chart_path and (os.path.exists(active_chart_path) or os.path.exists(DATA_DIR / "charts" / f"{scoped_thread_id}.png")) else None
                            active_warnings = values.get("warnings", [])
                            yield {
                                "event": "final_answer",
                                "data": json.dumps({
                                    "content": clean_answer,
                                    "chart_url": chart_url,
                                    "chart_data": active_chart_data,
                                    "chart_type": "bar"
                                })
                            }
                            # Write the trace to localized trace storage
                            from core.logger import write_agent_trace
                            write_agent_trace(
                                thread_id=scoped_thread_id,
                                message=message,
                                steps=trace_steps,
                                final_answer=clean_answer,
                                chart_url=chart_url
                            )
                            # TIP-005 Telemetry validation logging
                            from core.database import log_session_audit
                            log_session_audit(
                                session_id=scoped_thread_id,
                                question=message,
                                answer=clean_answer,
                                steps=[s["output"] for s in trace_steps],
                                chart_b64=chart_url,
                                warnings=active_warnings
                            )
            
            # Send end signal
            yield {"event": "done", "data": "end"}
            
            # TIP-005: cleanup temp folder session lifecycle close
            from core.database import cleanup_session
            cleanup_session(scoped_thread_id, str(TEMP_DIR / scoped_thread_id))
            
        except Exception as e:
            import traceback
            print("[SSE Error Traceback]")
            traceback.print_exc()
            yield {
                "event": "error",
                "data": json.dumps({"detail": str(e)})
            }
            # Cleanup on error as well
            from core.database import cleanup_session
            cleanup_session(scoped_thread_id, str(TEMP_DIR / scoped_thread_id))

    return EventSourceResponse(event_generator())

# Global Fallback InMemory store if Redis is unavailable
_in_memory_rates = {}

@app.get("/api/v1/demo")
async def demo_stream(message: str, session_id: str):
    """
    Demo API endpoint without JWT, rate limited to 3 queries per Session.
    Fixes queries to FPT 2025 Financial Reports data.
    """
    async def demo_event_generator():
        try:
            # 1. Check Rate Limit
            limit_exceeded = False
            try:
                r = redis.from_url(REDIS_URL, socket_timeout=2)
                key = f"demo_rate:{session_id}"
                count = r.incr(key)
                if count == 1:
                    r.expire(key, 86400) # Expire in 24h
                if count > 3:
                    limit_exceeded = True
            except Exception as redis_err:
                print(f"[Redis Warning] Fallback to In-Memory due to: {str(redis_err)}")
                # Fallback to in-memory storage
                current_count = _in_memory_rates.get(session_id, 0) + 1
                _in_memory_rates[session_id] = current_count
                if current_count > 3:
                    limit_exceeded = True

            if limit_exceeded:
                yield {
                    "event": "error",
                    "data": json.dumps({"detail": "Rate limit exceeded. You have reached the maximum of 3 questions allowed for the Guest demo."})
                }
                return

            # 2. Directly invoke LangGraph workflow with fixed embedded `source_filter`
            inputs = {
                "messages": [HumanMessage(content=message)], 
                "steps": [],
                "source_filter": "15767250-129f-4839-ba16-167472976d62.md" # Fixed FPT 2025 document
            }
            
            config = {
                "configurable": {
                    "thread_id": f"demo_{session_id}", 
                    "session_tmp_dir": str(TEMP_DIR / f"demo_{session_id}")
                }
            }
            
            (TEMP_DIR / f"demo_{session_id}").mkdir(parents=True, exist_ok=True)

            active_chart_path = None
            active_chart_data = None
            trace_steps = []
            
            async with get_async_graph_app() as graph_app:
                async for output in graph_app.astream(inputs, config=config):
                    for node, values in output.items():
                        if "chart_path" in values and values["chart_path"]:
                            active_chart_path = values["chart_path"]
                        if "execution_result" in values and values["execution_result"]:
                            parsed = extract_chart_data(values["execution_result"])
                            if parsed:
                                active_chart_data = parsed
                        
                        # Map the thought steps (Thinking UI for frontend)
                        step_msg = values["steps"][-1] if values.get("steps") else f"Executing {node}..."
                        trace_steps.append({"node": node, "output": step_msg})
                        yield {
                            "event": "step",
                            "data": json.dumps({"node": node, "output": step_msg})
                        }
                        
                        if "final_answer" in values:
                            clean_answer = values["final_answer"].replace("[CHART_01_RENDERED]", "").strip()
                            if active_chart_path:
                                persist_chart(active_chart_path, f"demo_{session_id}")
                            chart_url = f"/chart/demo_{session_id}" if active_chart_path and (os.path.exists(active_chart_path) or os.path.exists(DATA_DIR / "charts" / f"demo_{session_id}.png")) else None
                            yield {
                                "event": "final_answer",
                                "data": json.dumps({
                                    "content": clean_answer,
                                    "chart_url": chart_url,
                                    "chart_data": active_chart_data,
                                    "chart_type": "bar"
                                })
                            }
                            # Write the trace to localized trace storage
                            from core.logger import write_agent_trace
                            write_agent_trace(
                                thread_id=f"demo_{session_id}",
                                message=message,
                                steps=trace_steps,
                                final_answer=clean_answer,
                                chart_url=chart_url
                            )
            
            yield {"event": "done", "data": "end"}

        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"detail": str(e)})
            }

    return EventSourceResponse(demo_event_generator())

@app.get("/health")
@app.head("/health")
def health_check():
    return {"status": "ok"}

@app.get("/")
@app.head("/")
def root():
    return {"status": "ok", "message": "Financial Analyzer API is running"}

# Serve Trace Dashboard UI
from fastapi.responses import RedirectResponse
trace_dashboard_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "trace-dashboard")
if os.path.exists(trace_dashboard_path):
    @app.get("/trace")
    async def redirect_trace():
        return RedirectResponse(url="/trace/")
    app.mount("/trace", StaticFiles(directory=trace_dashboard_path, html=True), name="trace-dashboard")

# Serve React Static Files
static_path = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_path):
    app.mount("/assets", StaticFiles(directory=os.path.join(static_path, "assets")), name="static")
    
    @app.get("/{full_path:path}")
    async def serve_react(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("trace") or full_path in ["chat-stream", "upload", "health"]:
            return # Let FastAPI handle it
        return HTMLResponse(content=open(os.path.join(static_path, "index.html")).read())

if __name__ == "__main__":
    import uvicorn
    # Port 8001 to avoid conflict with existing Chainlit on 8000
    uvicorn.run(app, host="0.0.0.0", port=8001)
