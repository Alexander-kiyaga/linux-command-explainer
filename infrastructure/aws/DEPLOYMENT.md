# LinuxLab assignment deployment runbook

The assignment architecture is **EC2 public IPv4 → Nginx HTTP :80 → loopback Gunicorn → Flask** on one Amazon Linux 2023 instance. Playground, Missions and Bash execute only in the learner's browser simulation. This assignment configuration does not need a domain, Elastic IP, port 443 or a certificate. The ordinary EC2 public IPv4 address can change after stop/start; update the ignored Ansible inventory if it does.

Commands below are labeled by effect. Do not use a fresh Terraform state against an already managed instance: reconcile or import the existing state first.

## Prerequisites and local configuration

- A clean checkout of the exact `linuxlab-v2` commit being released; Python 3, Git, Terraform, Ansible, an AWS account, an existing public VPC/subnet and EC2 key pair.
- Access to the existing Terraform state if migrating the previous deployment. Inspect `terraform state list` and the proposed plan with the state owner. A current Amazon Linux AMI or different subnet/key value can replace an instance; preserve access until the plan is reviewed.
- A private controller-side systemd environment file outside the repository, such as `/secure/linuxlab-runtime.env`, containing `GEMINI_API_KEY=...` and any chosen bounded settings from `.env.example`. Restrict it to the administrator (`chmod 600`). Ansible copies it to `/opt/linuxlab/shared/runtime.env` (root-owned, application-group readable), never into a release archive. Gunicorn binds only to `127.0.0.1:8000`.

Copy `terraform.tfvars.example` to ignored `terraform.tfvars`, `inventory.ini.example` to ignored `inventory.ini`, and `deploy-vars.yml.example` to ignored `deploy-vars.yml`. Fill in your AWS region, existing VPC/public subnet, existing EC2 key name, administrator IPv4 `/32`, the instance's current public IPv4, SSH private-key path, release identity and private environment-file path. No domain or DNS input is needed.

## 1. Create and verify a release — local only, no AWS change

```bash
git status --short
git rev-parse HEAD
python3 scripts/release.py build --repo . --commit HEAD --output-dir dist
```

`build` rejects a dirty tree by default and always creates a fresh archive from tracked files in the requested Git commit. It packages the application, `wsgi.py`, `requirements.txt`, and `release.json`; it excludes `.env`, Git history, Terraform state/plans, virtual environments and caches. The output gives the archive's absolute path, full commit and SHA-256, also recorded in a sibling `.sha256` file. `--allow-dirty` is for local audits only: it still packages committed content, never local edits. Ansible refuses a dirty deployment checkout.

Put the printed **absolute archive path**, full commit and checksum in `deploy-vars.yml`, then compare the archive against Git:

```bash
python3 scripts/release.py verify --artifact /absolute/path/to/archive.tar.gz --commit FULL_COMMIT --sha256 FULL_SHA256 --repo .
```

`release.json` stores the full Git commit and tree identity. Rebuilding the same commit produces the same archive bytes and checksum.

## 2. Review Terraform — local checks versus AWS changes

**Local-only checks:**

```bash
cd infrastructure/aws
terraform fmt -check
terraform init -backend=false
terraform validate
```

Initialization may download the locked AWS provider locally; it does not change infrastructure. **AWS read/plan:** use the correct existing state and run `terraform plan -out=review.tfplan`, then examine every proposed EC2 and security-group change. A plan can contact AWS and lock a configured state backend. **AWS-changing command, deferred until approval:** `terraform apply review.tfplan`. Never apply from an empty state when the old instance is managed elsewhere.

The security group allows public HTTP 80 and SSH only from the administrator's IPv4 `/32`; it does not open 443. The 12 GiB gp3 root volume remains encrypted and IMDSv2 remains required. Terraform outputs `public_ip`, which becomes the Ansible inventory address. The legacy security-group name/description and auto-public-IP setting are retained to reduce replacement risk, but the actual plan is authoritative.

## 3. Deploy a verified archive — changes the EC2 instance

After the public IPv4 address is in the ignored inventory, run **only after approval**:

```bash
ansible-playbook -i infrastructure/aws/inventory.ini infrastructure/aws/deploy.yml -e @infrastructure/aws/deploy-vars.yml
```

The playbook requires its checkout to be clean and at `release_commit`. It verifies the controller archive against Git, verifies the transferred bytes, and extracts only into `/opt/linuxlab/releases/.staging-<commit>`. It creates a release-specific Python environment and installs pinned dependencies before moving the complete directory to `/opt/linuxlab/releases/<full-commit>`. It refuses to overwrite an existing release.

Only after installation and configuration does `switch_release.py` atomically update `/opt/linuxlab/current`, saving the former target as `/opt/linuxlab/previous`. The existing `linux-explainer.service` name is retained for migration; it uses `current` and the shared private environment file. Two Gunicorn workers are retained. Nginx directly serves `/static/` with a five-minute revalidation cache; application and API routes proxy to Gunicorn. The three paid AI endpoints retain 6 requests/minute per IP, burst 2, and one concurrent request globally. Rate-limit responses are JSON with HTTP 429. Flask's input validation, sanitized errors and security headers remain enabled; Nginx adds matching headers to its own static and error responses. HTTP traffic itself is unencrypted, so do not send secrets or sensitive tasks through the public site.

The playbook probes `/health`, all six learning pages, the Bash worker, response headers and the private active `release.json` identity through local Nginx. No smoke check calls Gemini. Failed post-switch verification restores `previous`, restores the prior Nginx configuration when changed, and restarts the application. A failed first install clears `current` and stops the new service.

## 4. Identify and roll back a release — server changes

On the instance, read `/opt/linuxlab/current/release.json` or run `readlink /opt/linuxlab/current` to identify the active commit. `readlink /opt/linuxlab/previous` identifies the prior release. These metadata paths are not public web routes. Check `systemctl status linux-explainer nginx` and the HTTP smoke URLs without asking Gemini.

For a manual rollback **on the server**, after confirming `previous` exists:

```bash
sudo python3 /opt/linuxlab/tools/switch_release.py rollback --root /opt/linuxlab
sudo systemctl restart linux-explainer
sudo systemctl reload nginx
```

The switch atomically swaps `current` with `previous`; versioned release files are never mixed. Rollback does not change the shared environment or Nginx configuration. A first deployment has no previous release. Keep at least the current and previous release directories. Reusing the same failed commit requires reviewing and removing its inactive directory before retrying.

## Migration and optional future HTTPS

The previous playbook extracted a manually existing `application.tar.gz` over `/opt/linux-command-explainer`. This deployment does not use that archive or directory. It retains the service name so the new unit replaces the old process at activation. During the first switch, Nginx's new `/static/` mapping can briefly lack files until `current` exists. The old application directory remains available for manual recovery; it is not an automatic rollback target. Review the existing Terraform state before any apply.

HTTPS is **outside the assignment deployment**. A later public production upgrade would need a domain or another TLS termination method, certificate issuance and renewal, an HTTPS listener, an HTTP redirect and certificate-aware smoke tests. HSTS should be considered only after HTTPS is working and verified. None of those resources or steps is enabled by this repository's assignment playbook.
