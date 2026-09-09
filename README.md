# 🐧 Linux Command Explainer

A clean, modern, beginner-friendly web application that explains Linux commands in plain English using the official Google Gemini Python SDK.

Designed with strict safety and educational clarity:
- **Zero Execution Policy**: User-submitted commands are analyzed purely as text and **never executed**.
- **Prompt Injection Defense & Safe Rendering**: System instructions and input boundaries isolate untrusted text. All frontend rendering uses `textContent` and DOM element creation (never `innerHTML`).
- **Nuanced Impact Classification**: Commands are classified into `read`, `modify`, `delete`, `depends` (flags determine outcome), or `unknown`. Read-only commands are never falsely labeled as "automatically safe".
- **Searchable Command Dictionary**: 35 curated common Linux commands across 4 categories with real-time search, one-click copy, and one-click explanation.
- **Honest Setup Notice**: When no API key is configured, the application displays clear setup guidance instead of presenting fake mock responses as real AI.

---

## 🛠️ Technology Stack

- **Backend**: Python 3 (tested on 3.14 / 3.10+), [Flask 3.1](https://palletsprojects.com/p/flask/)
- **AI Integration**: Official Google Gemini Python SDK (`google-genai` 2.22), [Pydantic 2.13](https://docs.pydantic.dev/) structured outputs
- **Frontend**: Semantic HTML5, modern CSS3 (responsive flexbox/grid, accessible color contrast), minimal vanilla JavaScript (zero frontend build tools or Node.js required)
- **Production Server**: Gunicorn 26.2 (WSGI ready for future AWS EC2 deployment)
- **Testing**: pytest 9.1

---

## 📁 Project Structure

```
linux-command-explainer/
├── .env.example                  # Environment configuration template
├── .gitignore                    # Excludes .env, venv/, __pycache__/, and caches
├── requirements.txt              # Pinned, tested dependency versions
├── wsgi.py                       # WSGI entrypoint for both local execution and Gunicorn
├── README.md                     # Documentation and setup instructions
├── app/
│   ├── __init__.py               # Flask application factory (create_app)
│   ├── config.py                 # Configuration loader and timeout converter
│   ├── explainer.py              # Gemini API service with Pydantic structured output
│   ├── routes.py                 # Flask route blueprints (/, /api/explain, /api/commands, /health)
│   ├── data/
│   │   └── commands.json         # Searchable dictionary of 35 curated Linux commands
│   ├── static/
│   │   ├── css/
│   │   │   └── style.css         # Modern, responsive developer dark-theme CSS
│   │   └── js/
│   │       └── app.js            # Safe client-side logic using textContent
│   └── templates/
│       └── index.html            # Semantic HTML5 single-page application
└── tests/
    ├── __init__.py
    ├── test_commands_data.py     # Verifies dictionary completeness, categories, and impacts
    ├── test_routes.py            # Tests HTTP routes, payload validation, and missing key flow
    ├── test_explainer_mocked.py  # Tests explainer service using MOCKED Gemini responses
    └── test_live_gemini_optional.py # Optional test calling real Gemini API (skipped by default)
```

---

## 🚀 Local Setup & Installation

### 1. Prerequisites
- Python 3.10 or higher.
- `pip` and `venv`.

### 2. Create and Activate a Virtual Environment
```bash
# In the project directory:
python3 -m venv venv

# On macOS / Linux:
source venv/bin/activate
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

---

## 🔑 Configuring Your Gemini API Key Privately

1. **Get a Gemini API Key**:
   Create a free API key at [Google AI Studio](https://aistudio.google.com/app/apikey).

2. **Create Your `.env` File**:
   Copy the provided `.env.example` template:
   ```bash
   cp .env.example .env
   ```

3. **Add Your Key**:
   Open `.env` in your editor and insert your key:
   ```ini
   GEMINI_API_KEY=AIzaSyYourActualKeyHere
   GEMINI_MODEL=gemini-2.5-flash
   API_TIMEOUT_SECONDS=15
   MAX_INPUT_LENGTH=500
   PORT=5000
   FLASK_DEBUG=False
   ```

> [!IMPORTANT]
> Your `.env` file is listed in `.gitignore` and must **never** be committed to version control or shared publicly.

---

## ▶️ Running the Application Locally

Start the local development server bound to `127.0.0.1`:

```bash
python wsgi.py
```

You will see the startup banner:
```
============================================================
  🐧 Linux Command Explainer - Development Server
  Local Address: http://127.0.0.1:5000
  Gemini Model:  gemini-2.5-flash
  API Key:       Configured
============================================================
 * Running on http://127.0.0.1:5000
```

Open your browser and navigate to:
```
http://127.0.0.1:5000
```

---

## 🧪 Running Automated Tests

The test suite thoroughly covers input validation, dictionary integrity, HTTP routes, and mocked AI responses without requiring an active API key.

### Run Local Unit & Mocked Tests:
```bash
pytest -v
```

All 34 core tests will pass in < 1 second.

### Optional: Test Against the Real Gemini API
To verify connectivity with your actual configured key:
```bash
RUN_REAL_GEMINI_TEST=1 pytest tests/test_live_gemini_optional.py -v
```
*(This is skipped by default so tests run fast, offline, and without consuming API quota.)*

---

## 💡 Key Features & Architectural Decisions

### 1. Zero Command Execution
- No `subprocess`, `os.system`, or shell calls exist anywhere in the application.
- All command analysis is purely natural-language understanding through Gemini.

### 2. Prompt Injection Mitigation & Safe Output
- User input is encapsulated inside `<UNTRUSTED_COMMAND>` tags with system instructions explicitly stating that text within tags must be analyzed as code, never obeyed as instructions.
- Length is capped at 500 characters on both client and server.
- The frontend uses `node.textContent` and DOM node construction exclusively. **No dynamic string concatenation into `innerHTML` is performed.**

### 3. Nuanced Impact Classification
Commands are not simplified into "safe" vs "dangerous":
- **`read`**: Reads or queries information (e.g. `ls -lah`, `cat /etc/os-release`). *Note: Reading commands are NOT labeled as automatically safe, because viewing sensitive files (e.g. credentials) or dumping infinite streams (`cat /dev/urandom`) poses real security and system risks.*
- **`modify`**: Modifies files, directories, permissions, or system state (e.g. `mkdir -p`, `cp -r`, `chmod 755`).
- **`delete`**: Permanently removes files, unlinks inodes, or terminates processes (e.g. `rm -rf`, `kill -9`).
- **`depends`**: Outcome depends heavily on options or arguments (e.g. `sed` without `-i` streams to stdout, while `sed -i` alters files in place).
- **`unknown`**: Ambiguous or custom syntax.

### 4. Verified SDK Integration, Retries & Timeout Units
- Uses the official Google GenAI Python SDK (`google-genai` 2.22.0).
- **Exact Attempt Policy**: Client initialized with `retry_options=None`, which the SDK executes as `tenacity.stop_after_attempt(1)`. No automatic retries occur on daily quota exhaustion or errors, preventing stacked retries.
- **Thinking Configuration**: For Gemini 3 models (e.g. `gemini-3.6-flash`), `thinking_level=ThinkingLevel.LOW` is configured as verified in official documentation, reducing latency and reasoning token volume without altering the model's fixed daily quota.
- **Configurable Output Limit**: `MAX_OUTPUT_TOKENS` (default: 1500) caps output bloat. Truncated responses are caught gracefully and reported with actionable guidance without retrying.
- **Timeout Units**: `API_TIMEOUT_SECONDS` (default: 15s) is converted to milliseconds (`15,000 ms`) for `types.HttpOptions(timeout=...)`.

### 5. Submission Lock & Duplicate Prevention
- A client-side submission lock (`isSubmitting`) disables the input box, Explain button, quick example chips, and dictionary cards while a request is in flight. This prevents redundant duplicate requests during slow responses or transient server delays.

### 6. Granular Error Classification
- **Daily Quota Exhaustion (429)**: Specifically detects `GenerateRequestsPerDay` metrics, extracts reported `quotaValue` when available, states that Google's daily quota schedule typically resets at midnight Pacific Time, and warns that a short `retryDelay` will not resolve a daily limit.
- **Per-Minute Rate Limits (429)**: Differentiates short-term burst limits, advising users to pause 15–30 seconds.
- **Unknown Quota / Rate Limit (429)**: Provides a fallback when the exact metric cannot be determined.
- **Temporary Server Overload (503)**: Explains temporary Google server traffic spikes with a polite retry prompt.
- **Timeouts & Deadlines (504 / 408)**: Maps 504 `DEADLINE_EXCEEDED` and client timeouts to clear timeout messages.
- **Safe Duration Logging**: Measures live latency using `time.perf_counter()` and logs execution times without exposing API keys or credentials.

---

## ☁️ Future AWS EC2 Deployment Guide (Preview)

When deploying to AWS EC2:

1. **WSGI Server**: Run Gunicorn with multiple workers:
   ```bash
   gunicorn -w 4 -b 127.0.0.1:5000 wsgi:app
   ```
2. **Reverse Proxy**: Place Nginx in front of Gunicorn to handle HTTPS (Let's Encrypt), static file caching, and rate limiting.
3. **Process Management**: Run Gunicorn under `systemd` (`/etc/systemd/system/explainer.service`).
4. **Environment**: Keep `.env` on the EC2 instance with restricted permissions (`chmod 600 .env`).
