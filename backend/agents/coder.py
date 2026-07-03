import os
import re
import json
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from .state import AgentState
from backend.tools.sandbox import SafePythonREPL

from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
from core.config import CODER_MODEL, OLLAMA_BASE_URL

# Check if running on Render or if Nvidia NIM is explicitly requested for Coder
if os.getenv("RENDER") or os.getenv("USE_NVIDIA_FOR_CODER") == "True":
    nvidia_coder_key = os.getenv("NVIDIA_CODER_API_KEY")
    nvidia_key = os.getenv("NVIDIA_API_KEY")
    
    # Try NVIDIA_CODER_API_KEY first, fallback to NVIDIA_API_KEY
    active_key = nvidia_coder_key or nvidia_key
    
    if active_key:
        key_name = "NVIDIA_CODER_API_KEY" if nvidia_coder_key else "NVIDIA_API_KEY"
        print(f"[Coder] Using NVIDIA NIM (mistralai/mistral-small-4-119b-2603) via {key_name} as Coder LLM on Render/Web.")
        from core.nim_client import get_nim_llm
        llm = get_nim_llm("mistralai/mistral-small-4-119b-2603", temperature=0, api_key=active_key)
    else:
        openai_key = os.getenv("OPENAI_API_KEY")
        if openai_key:
            print("[Coder Warning] No NVIDIA API keys set. Falling back to ChatOpenAI (gpt-4o-mini)...")
            llm = ChatOpenAI(
                model="gpt-4o-mini",
                temperature=0,
                api_key=openai_key
            )
        else:
            print("[Coder Warning] No cloud LLM keys found. Falling back to ChatOllama...")
            llm = ChatOllama(
                base_url=OLLAMA_BASE_URL.replace("/v1", ""),
                model=CODER_MODEL,
                temperature=0
            )
else:
    # Default local development configuration
    llm = ChatOllama(
        base_url=OLLAMA_BASE_URL.replace("/v1", ""),
        model=CODER_MODEL,
        temperature=0
    )

def load_finance_dict() -> str:
    """Read the financial formulas dictionary to include in the Coder prompt."""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    # Compatible path: backend/tools/finance_dict.json
    dict_path = os.path.join(os.path.dirname(current_dir), "tools", "finance_dict.json")
    try:
        with open(dict_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return json.dumps(data, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[Coder] Cannot load financial formulas dictionary: {e}")
        return "{}"

CODER_PROMPT = r"""You are a specialized Financial Analysis Coder Agent.
Write Python code using pandas to process the financial data. Note that financial column names might contain Vietnamese diacritics, so handle them correctly.

IMPORTANT: If the query asks for standard financial statement items (such as Total Assets, Long-term Assets, Revenue, Net Income, etc.) or values directly present in the context tables, you should extract and plot them directly. Only refer to and adhere to the following financial formulas dictionary if the query explicitly asks to calculate a financial ratio (such as ROE, ROA, Quick Ratio, Debt to Equity, etc.):
{finance_dict}

IMPORTANT DATA CLEANING RULES:
1. Vietnamese financial data follows Vietnamese Accounting Standards (VAS) formatting (dot "." for thousands separator, comma "," for decimals, e.g. "1.234.567,89 VND").
2. To clean such data (especially DataFrame columns containing noise like currency symbols, spaces, or dots/commas), you MUST implement a robust 4-stage normalization pipeline:
   - Stage 0: Detect parenthesized negative numbers and convert to negative sign representation (e.g., "(120.000,00)" -> "-120.000,00"):
     `df['col'] = df['col'].astype(str).str.strip().str.replace(r'^\((.*)\)$', r'-\1', regex=True)`
   - Stage 1: Strip currency, spaces, and other noise except digits, dots, commas, and minus signs:
     `df['col'] = df['col'].str.replace(r'[^\\d\\.,-]', '', regex=True)`
   - Stage 2: Remove the thousands separator dots:
     `df['col'] = df['col'].str.replace('.', '', regex=False)`
   - Stage 3: Replace the decimal comma with dot, and cast to numeric:
     `df['col'] = pd.to_numeric(df['col'].str.replace(',', '.', regex=False), errors='coerce')`
3. Always verify datatypes and cast using the above 4-stage pipeline before calculations.
4. Wrap all calculation logic in a `try...except Exception as e:` block to log errors as `print(f"[Execution Error] {{e}}")` instead of crashing.
5. All text in charts must be in English. Use clear labels, titles, and legends. Do NOT call matplotlib.use() or set rcParams as they are pre-configured by the sandbox.
6. Make charts highly aesthetic and detailed:
   - Use professional colors (e.g., Indigo `#4F46E5` for primary data, Emerald `#10B981` for secondary, and Rose `#F43F5E` for comparison/negatives).
   - Draw exact numeric value labels (data labels) on top of bars or line markers.
   - For line charts, use markers (e.g., `marker='o'`, `markersize=6`) and professional line styling.
   - Prevent text overlap by rotating X-axis labels (e.g., `rotation=15`) if years or category names are long.
   - Adjust layout padding (e.g., `plt.tight_layout()`) to ensure no titles or axis labels are clipped.

--- FEW-SHOT EXAMPLES ---
Example 1: Calculate ROE using 4-stage column normalization
```python
import pandas as pd
try:
    # Context: DataFrame with columns 'Year', 'Net Income', 'Total Equity'
    # 'Net Income' values: ["120.500.000 VND", "150.000.000,50 VND"]
    # 'Total Equity' values: ["1.000.000.000 VND", "1.100.000.000,00 VND"]
    data = {{
        'Year': ['2023', '2024'],
        'Net Income': ["120.500.000 VND", "150.000.000,50 VND"],
        'Total Equity': ["1.000.000.000 VND", "1.100.000.000,00 VND"]
    }}
    df = pd.DataFrame(data)
    
    # 4-Stage Normalization Pipeline
    for col in ['Net Income', 'Total Equity']:
        # Stage 0: Convert parenthesized negative numbers
        df[col] = df[col].astype(str).str.strip().str.replace(r'^\((.*)\)$', r'-\1', regex=True)
        # Stage 1: Clean noise symbols and spaces
        df[col] = df[col].str.replace(r'[^\\d\\.,-]', '', regex=True)
        # Stage 2: Remove dot thousands separator
        df[col] = df[col].str.replace('.', '', regex=False)
        # Stage 3: Convert decimal comma to dot and cast to float
        df[col] = pd.to_numeric(df[col].str.replace(',', '.', regex=False), errors='coerce')
        
    df['ROE'] = df['Net Income'] / df['Total Equity']
    for idx, row in df.iterrows():
        print(f"Year {{row['Year']}} ROE: {{row['ROE']:.4f}} ({{row['ROE']*100:.2f}}%)")
except Exception as e:
    print(f"[Execution Error] {{e}}")
```

Example 2: Calculate growth rate
```python
import pandas as pd
try:
    # Context: 2023 Revenue = 500B VND, 2024 Revenue = 600B VND
    rev_2023 = 500.0
    rev_2024 = 600.0
    growth = (rev_2024 - rev_2023) / rev_2023
    print(f"Revenue Growth: {{growth * 100:.2f}}%")
except Exception as e:
    print(f"[Execution Error] {{e}}")
```
-------------------------

REQUIRED: Wrap your Python code within a markdown block: ```python ... ```.
Do not provide explanations outside the code block, no introductory or concluding text.

Request: {question}
Context Data: {context}

Rules:
1. ONLY return a ```python ... ``` markdown block. No explanations or comments outside the code block.
2. The code must be self-contained and initialize necessary variables from the context.
3. If drawing a chart, use matplotlib. Save the chart file exactly to this path: {chart_path}
4. If there was a previous error, fix it: {last_error}
5. The final output of the script must be printed using print(). All output text and chart text MUST be in English.
6. If the query requires tabular, time-series, or numerical data comparison, you MUST also output the calculated data as a JSON array (where each element has a "name" field representing the year/period/category, e.g. [{{"name": "2023", "Revenue": 500000.0}}]) wrapped inside a "<json_data>...</json_data>" tag block printed to stdout.
"""

def pre_sanitize_context(text: str) -> str:
    """
    Clean Vietnamese format numbers (e.g. 1.234.567 -> 1234567) in context 
    to minimize syntax errors for LLM.
    """
    if not text:
        return text
    # 1. Match 3 digit groups separated by dot (Millions): X.XXX.XXX
    text = re.sub(r'(\d{1,3})\.(\d{3})\.(\d{3})', lambda m: m.group().replace('.', ''), text)
    # 2. Match simple thousands dot: X.XXX
    text = re.sub(r'\b(\d{1,3})\.(\d{3})\b', lambda m: m.group().replace('.', ''), text)
    return text

def coder_node(state: AgentState, config: RunnableConfig) -> dict:
    """Node that generates code and executes it in a secure sandbox REPL."""
    error_count = state.get("error_count", 0)
    question = state["question"]
    raw_context = state["messages"][-1].content if state["messages"] else ""
    context = pre_sanitize_context(raw_context)
    
    # Sliding Window Memory Reducer: last_error aggregates up to the last 3 traceback errors
    last_error = "\n".join(state.get("tracebacks", [])) if state.get("tracebacks") else "None"

    # Get session_tmp_dir from config (ensures multi-user safety)
    configurable = config.get("configurable", {})
    session_tmp_dir = configurable.get("session_tmp_dir", "tmp")
    chart_path = os.path.join(session_tmp_dir, "chart.png")

    # Load financial formulas dictionary
    finance_dict_str = load_finance_dict()

    # 1. Generate Code
    prompt = ChatPromptTemplate.from_messages([("system", CODER_PROMPT)])
    chain = prompt | llm
    
    # Access runnable config to get thread_id for tracking token usage
    from core.logger import TokenUsageCallbackHandler
    
    # Retrieve thread_id from context/config or default
    thread_id = "unknown_thread"
    if isinstance(config, dict) and "configurable" in config:
        thread_id = config["configurable"].get("thread_id", "unknown_thread")
    elif hasattr(config, "get"):
        thread_id = config.get("configurable", {}).get("thread_id", "unknown_thread")
        
    token_callback = TokenUsageCallbackHandler(session_id=thread_id, node_name="coder")
    
    response = chain.invoke({
        "question": question,
        "context": context,
        "finance_dict": finance_dict_str,
        "last_error": last_error,
        "chart_path": chart_path.replace("\\", "/") # Use forward slash for Python script
    }, config={"callbacks": [token_callback]})
    
    code = response.content.strip()
    code_match = re.search(r'```python\s*(.*?)\s*```', code, re.DOTALL)
    if not code_match:
        code_match = re.search(r'```\s*(.*?)\s*```', code, re.DOTALL)
    
    if code_match:
        code = code_match.group(1).strip()
    else:
        # Post-processing if there is no markdown block
        lines = code.split('\n')
        cleaned_lines = []
        in_code = False
        for line in lines:
            if any(kw in line for kw in ['import ', 'print(', 'df =', 'def ', '= ']):
                in_code = True
            if in_code:
                cleaned_lines.append(line)
        if cleaned_lines:
            code = '\n'.join(cleaned_lines).strip()

    print(f"[Coder] Attempt {error_count + 1}: Executing generated code...")
    
    # 2. Execute via secure Sandbox
    repl = SafePythonREPL()
    try:
        exec_res = repl.execute(code)
        
        if not exec_res["success"]:
            err_msg = exec_res["error"] or exec_res["stderr"] or "Unknown execution error"
            print(f"[Coder] Execution failed with error: {err_msg}")
            return {
                "current_code": code,
                "execution_result": f"[Execution Error] {err_msg}",
                "tracebacks": [err_msg],
                "error_count": error_count + 1,
                "steps": [f"Attempting correction: Coder executed script (attempt {error_count + 1}) but encountered exception: {err_msg[:50]}..."]
            }

        print("[Coder] Execution Success.")
        
        # Get printed stdout
        result = exec_res["stdout"]
        # Get base64 chart plot if generated
        plot_b64 = exec_res["plot"]
        
        chart_val = None
        if plot_b64:
            try:
                import base64
                os.makedirs(os.path.dirname(chart_path), exist_ok=True)
                with open(chart_path, "wb") as f:
                    f.write(base64.b64decode(plot_b64))
                chart_val = chart_path
            except Exception as e:
                print(f"[Coder Warning] Failed to write base64 plot to {chart_path}: {e}")
                chart_val = f"data:image/png;base64,{plot_b64}"
        elif os.path.exists(chart_path):
            chart_val = chart_path

        return {
            "current_code": code,
            "execution_result": result,
            "messages": [AIMessage(content=f"Calculation result:\n{result}")],
            "error_count": error_count,
            "chart_path": chart_val,
            "steps": ["Coder executed program successfully."]
        }
    except Exception as e:
        err_msg = str(e)
        print(f"[Coder] Runtime Exception: {err_msg}")
        return {
            "current_code": code,
            "execution_result": f"[Execution Error] {err_msg}",
            "tracebacks": [err_msg],
            "error_count": error_count + 1,
            "steps": [f"Coder encountered runtime error: {err_msg}"]
        }
