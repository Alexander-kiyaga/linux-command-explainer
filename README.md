# LinuxLab AI

LinuxLab AI grows from the existing Linux Command Explainer. Home, Explain, Task Builder, Playground, and Missions are available. Bash remains planned.

## Current features

- **Home (`/`)** introduces the learning tools and links to Explain, Task Builder, Playground, and Missions.
- **Explain (`/explain`)** analyzes command text with Google Gemini and returns a plain-English summary, token breakdown, impact notes, examples, version notes, and safety warnings. Submitted commands are never executed.
- **Task Builder (`/task-builder`)** asks Gemini for a validated educational plan. LinuxLab independently checks each command against Playground V1 syntax; only one supported command can be transferred at a time for preview, insertion, and an explicit simulated Run.
- **Playground (`/playground`)** runs a bounded command interpreter against a browser-only virtual filesystem. It has no command execution endpoint and does not call a host shell, real filesystem, or network service.
- **Missions (`/missions`)** offers nine authored scenarios using the same browser-only simulator. Completion is determined by virtual session state, with authored hints and separate local progress. No Gemini call grades missions.
- **Quick reference** contains 35 curated commands across four categories, with search, copy, and Explain actions.
- **API** keeps the existing `POST /api/explain`, `POST /api/task-builder/plan`, `GET /api/commands`, and `GET /health` endpoints.

AI responses are rendered as text in the browser. Prompt boundaries and structured output reduce risk, but AI explanations should still be reviewed before using a command on a real system.

## Stack and structure

- Python, Flask, Gunicorn
- Google Gemini via `google-genai`, with Pydantic response validation
- Server-rendered Jinja HTML, CSS, and vanilla JavaScript; no frontend build step
- pytest for offline route, dictionary, mocked AI, and simulation-boundary tests
- JavaScriptCore or Node.js as a development-only runtime for pure JavaScript engine tests; neither is needed in production

```
app/
  __init__.py              Flask application factory
  config.py                Environment settings
  routes.py                Pages and existing API endpoints
  explainer.py             Explain Gemini integration and response schema
  task_builder.py          Separate Gemini task-plan schema, prompt, and service
  data/commands.json      Curated command reference
  templates/base.html      Shared header, navigation, and footer
  templates/index.html     Home page
  templates/explain.html   Existing Explain interface
  templates/playground.html Browser-only simulated terminal
  templates/missions.html  Guided mission interface
  templates/task_builder.html Educational AI task planner
  static/css/style.css    Shared site and Explain styling
  static/css/playground.css Shared terminal styling
  static/css/missions.css Missions styling
  static/css/task-builder.css Task Builder styling
  static/js/explain.js    Explain and dictionary browser behavior
  static/js/playground.js Playground UI controller
  static/js/terminal-ui.js Shared terminal presentation
  static/js/missions.js Missions UI controller
  static/js/missions/ Authored catalog, pure checker, attempt state, and storage
  static/js/task-builder.js Task Builder browser controller
  static/js/task-builder-storage.js Session-only plan and one-command draft
  static/js/simulation/compatibility.js Pure Playground syntax classifier
  static/js/playground-storage.js Browser persistence adapter
  static/js/simulation/ Pure parser, virtual filesystem, commands, and engine
infrastructure/aws/       Tracked Terraform and Ansible configuration
requirements.txt          Pinned Python dependencies
tests/                    Python and JavaScript tests plus optional live Gemini test
wsgi.py                   Local and Gunicorn entry point
```

Explain loads its browser script only on `/explain`. Task Builder uses its own page, prompt, and response schema. Playground and Missions share the same terminal presentation and simulation engine, but have separate virtual sessions and browser storage. The simulator and mission checker are independent of the DOM, Flask, and Gemini.

## Local setup

Use Python 3.10 or newer. From the project directory:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set `GEMINI_API_KEY` in `.env`, then start the app:

```bash
python wsgi.py
```

Open `http://127.0.0.1:5000/` for Home, `/explain` for Explain, or `/playground` for Playground, or `/missions` for Missions, or `/task-builder` for Task Builder. Playground and Missions work without an API key. Without a key, Explain displays setup guidance instead of fabricated AI output. Keep `.env` private; it is ignored by Git.

## Playground V1 scope

The available commands are `pwd`, `ls`, `cd`, `mkdir`, `touch`, `cat`, `echo`, `cp`, `mv`, `rm`, `head`, `tail`, `grep`, `find`, `chmod`, `whoami`, `clear`, and the simulator's `help` command. Supported options are `ls -a -l`, `mkdir -p`, `echo -n`, `cp -r`, `rm -r -f`, `head/tail -n N`, `grep -i -n -F`, `find -name PATTERN -type f|d`, and three-digit octal `chmod`. Combined short flags and `--` work where applicable. `find -name` supports `*` and `?` inside a quoted pattern.

The parser accepts one command line with simple quotes, escaped characters, and one virtual output redirect (`>` or `>>`). It rejects pipes, input redirects, multiple commands, general shell wildcard expansion, variables, command substitution, regex `grep`, networking, and real Bash. Results model a deliberately limited teaching subset of Linux; they are not a complete or exact shell implementation. Files, directories, contents, modes, and time are virtual. Changes and a bounded command history are saved in this browser, and Reset restores the starter snapshot.

V1 treats each command as one atomic virtual change: errors leave the prior snapshot intact, and output redirects write only after a successful command. A real shell can have partial effects and handles redirects differently. Permission checks use one virtual user and basic owner/group/other bits; ACLs, special bits, `sudo`, and advanced POSIX behavior are outside V1. `cp` and `mv` accept one source and destination, and directory merging is not supported. The terminal transcript is cleared on reload, while files, working directory, and the last 100 commands persist.

## Task Builder V1 scope

Task Builder sends the learner's task description to Gemini only after an explicit submission. The server validates a bounded, structured plan before returning it. The browser independently classifies each command using Playground's parser, registry, and shared syntax checks. A supported label means the syntax is recognized; current virtual files and permissions may still cause it to fail. Unsupported and partially supported steps remain visible for study, without a Try button. Generated text is never an execution instruction.

Try in Playground transfers one command as a one-time, versioned draft in browser session storage. Playground previews it against the existing virtual session, then requires Insert into terminal and a separate Run. The handoff never changes Playground or Missions files. The latest plan can be restored in the same browser tab without another Gemini call; Clear plan removes it. No entire-plan execution, host shell, or real filesystem access is provided.

## Missions V1 scope

Nine missions progress from navigation and file creation to copying a directory tree, changing a simplified permission mode, and tidying an incident workspace. Every mission starts from a validated virtual snapshot. The checker reads only virtual files, directories, contents, modes, and the current directory. It does not inspect the command sequence or use AI. Multiple supported command sequences can satisfy the same objectives.

Mission hints are authored and revealed one at a time. A command error leaves the attempt active; there is no timer or permanent failure state. Completing a mission freezes that attempt. Retry restores its starting snapshot, command history, and hints while retaining its completion badge. Browser storage keeps one active attempt and versioned completion records under keys separate from Playground. Clearing mission progress does not affect Playground. The terminal transcript is not saved. Progress is local browser data, without an account or server-side verification.

## Tests

Run the offline suite with:

```bash
pytest -q
```

The live Gemini test is skipped by default. To opt in, set `RUN_REAL_GEMINI_TEST=1` and configure a real API key before running `tests/test_live_gemini_optional.py`.

Run the pure JavaScript tests with either a development-only Node.js runtime (`npm run test:js`) or macOS JavaScriptCore (`/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/js/run.mjs`). There are no npm production dependencies or frontend build steps.

## Deployment configuration

`infrastructure/aws/` contains Terraform for an Amazon Linux EC2 instance and Ansible configuration for Nginx, Gunicorn, systemd, and a deployment health check. A separate `linux-explainer-aws` working directory may contain copies of these files and local Terraform state. The checked-in configuration currently serves HTTP on port 80; HTTPS is not configured. Updating or deploying AWS is outside this phase.

## Safety boundary

Explain treats commands as text and does not call a shell. Playground commands are parsed by a fixed browser-side registry and only mutate virtual state. The engine has no DOM, network, host filesystem, subprocess, or shell capability. Browser storage holds serialized virtual state; command handlers cannot access it. Missions already reuse this engine and grade only virtual state. Task Builder classifies syntax without calling command handlers, then transfers only a draft for deliberate practice. Future Bash work can reuse the same engine, but no Bash execution is implemented.
