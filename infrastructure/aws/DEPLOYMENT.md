# LinuxLab assignment deployment runbook

The assignment architecture is **EC2 public IPv4 → Nginx HTTP :80 → loopback Gunicorn → Flask**. Playground, Missions and Bash execute in the browser's simulation. A domain, Elastic IP, port 443 and certificate are not required. The ordinary EC2 public IPv4 can change after stop/start.

**Commands below identify whether they are local/read-only or change AWS/the server. No Terraform operation is part of an application-only release.**

## 1. Identify the existing infrastructure before planning

The original assignment state is `/Users/zandabeats/linux-explainer-aws/terraform.tfstate` on the original controller. It manages `aws_instance.web` (`i-0dca3d83202f83816`) and `aws_security_group.web` (`sg-0baa2c433ac631de4`), including encrypted root volume `vol-000f5ad8fc9105ee7`. This is the **authoritative existing state** until an explicitly approved migration chooses another location/backend. The new `infrastructure/aws` directory has no copy. Never plan or apply against an empty default state for this deployment: that could propose duplicates. Never copy, import or move state as an incidental application-deployment step.

**Local read-only identity check**, using the original state's absolute path:

```bash
python3 scripts/check_terraform_state.py \
  --state /Users/zandabeats/linux-explainer-aws/terraform.tfstate \
  --instance-id i-0dca3d83202f83816 \
  --security-group-id sg-0baa2c433ac631de4 \
  --root-volume-id vol-000f5ad8fc9105ee7
```

Keep `terraform.tfvars` ignored by Git. For reconciliation, set `ami_id` to the existing instance's AMI (`ami-0b79f6b294a030f24`), not a moving “latest” reference. For **new** infrastructure, explicitly look up and review a suitable current Amazon Linux 2023 AMI, then pin that ID in its separate environment configuration. AMI upgrades are deliberate infrastructure changes, not side effects of a LinuxLab release. The chosen subnet must auto-assign public IPv4 and have an Internet Gateway route. The instance configuration leaves association to the subnet rather than treating a stopped instance's missing public IP as a replacement instruction. `prevent_destroy` makes an unexpected replacement fail instead of deleting the instance and root volume; inspect and resolve such plans rather than hiding drift.

**Local Terraform checks:** `terraform -chdir=infrastructure/aws fmt -check`, `terraform -chdir=infrastructure/aws init -backend=false`, and `terraform -chdir=infrastructure/aws validate`. Initialization may write a local provider cache; it does not change AWS. **Read-only AWS plan, only after the identity check and once EC2 is running:** explicitly target the original state, for example `terraform -chdir=infrastructure/aws plan -state=/absolute/path/to/original/terraform.tfstate -lock=false -input=false` with reviewed variables. The `-state` flag is deprecated; establish a canonical backend/state location under separate approval before any apply. A plan is not trustworthy while the instance is stopped and its temporary public-IP association is absent. Reject any plan that replaces `aws_instance.web` or destroys its root volume. Do not apply merely to deploy application code.

The security group permits public HTTP 80 and SSH from the configured administrator IPv4 `/32`. The 12 GiB gp3 root volume remains encrypted and IMDSv2 remains required. Port 443 is closed.

## 2. Build and verify a release — local only

Use a clean checkout of the intended Git commit. The release-artifact contract is unchanged:

```bash
git status --short
git rev-parse HEAD
python3 scripts/release.py build --repo . --commit HEAD --output-dir dist
python3 scripts/release.py verify --artifact /absolute/path/to/archive.tar.gz \
  --commit FULL_COMMIT --sha256 FULL_SHA256 --repo .
```

`build` rejects a dirty tree, packages tracked application files from that commit, and emits `release.json` with commit/tree identity plus a SHA-256 checksum. It excludes `.env`, Git history, Terraform state/plans, virtual environments and caches. `--allow-dirty` is for local audits only and still packages committed content. Ansible refuses a dirty deployment checkout.

## 3. Prepare private settings and a recovery point — server/AWS changes only when approved

Create an explicit private controller-side systemd environment file **outside Git and the repository**, such as `/secure/linuxlab-runtime.env`, containing `GEMINI_API_KEY=...` and chosen bounded settings from `.env.example`. Its permissions must be `0400` or `0600`; the playbook rejects broader permissions. It installs the file as `/opt/linuxlab/shared/runtime.env`, root-owned and application-group readable (`0640`), outside every release. Do not point deployment at the existing repository-local `.env` while it is `0644`; do not print, archive or automatically alter it. The old `/opt/linux-command-explainer/.env` remains untouched for legacy recovery. Verify its **presence**, not its contents, before migration.

Immediately before the first actual LinuxLab deployment, after the instance is running and server inspection is complete, take an **EBS snapshot of `vol-000f5ad8fc9105ee7` under separate AWS-change approval**. Record its snapshot ID and recovery procedure. The snapshot adds disk recovery, but does not replace service/Nginx recovery. No snapshot is created by release building or this playbook.

Copy the examples to ignored `infrastructure/aws/inventory.ini` and `infrastructure/aws/deploy-vars.yml`. Set the instance's **current** public IP, SSH key path, full release commit, absolute archive path, checksum and private environment source. No domain or DNS input is needed.

## 4. Deploy a verified release — changes the EC2 host; requires approval

```bash
ansible-playbook -i infrastructure/aws/inventory.ini infrastructure/aws/deploy.yml \
  -e @infrastructure/aws/deploy-vars.yml
```

The playbook first verifies the controller commit, clean checkout, artifact and checksum. It verifies uploaded bytes and stages a fresh `/opt/linuxlab/releases/.staging-<commit>` directory. It installs dependencies in a release-specific virtual environment, copies private settings separately, checks required files, and probes Flask `/health` using the staged virtual environment without starting a public service. It renders/validates future systemd and Nginx configurations under `/opt/linuxlab/prepared/`. None of these preparation steps replaces the active service unit, reloads Nginx or changes `/opt/linuxlab/current`. Only a fully prepared release is moved to `/opt/linuxlab/releases/<full-commit>`. A non-listening Gunicorn check runs from the finalized path before activation. The service launches `python -m gunicorn` because a virtualenv console script created in `.staging-<commit>` retains its old shebang after the directory move.

The staged release gate checks application files and static directories separately. It follows `venv/bin/python` (normally a symlink), requires its target to be a regular executable, and runs it as the application user before finalizing the release. A failed preparation can leave its commit-specific staging directory for diagnosis. A later **new commit** uses a different staging and release path; leave old failed staging and inactive releases in place until a separately reviewed maintenance cleanup after LinuxLab is serving successfully.

On Amazon Linux 2023, the playbook installs `curl-minimal` (which provides the `curl` executable used by smoke checks) alongside Nginx. It verifies that `curl` is available before migration preparation; the full `curl` package conflicts with the default `curl-minimal` package.

For the **first deployment over the legacy application**, the playbook checks that the old application directory, service unit, Nginx configuration and `.env` exist, both services are running, and the old root page responds. It preserves copies of the original service unit and Nginx configuration in root-only `/opt/linuxlab/legacy-recovery/`; the old application directory and `.env` remain in place. Preparation failure leaves the old service and active Nginx configuration untouched.

Activation then atomically switches `current`, installs/restarts the new Gunicorn unit, and probes Gunicorn directly on `127.0.0.1:8000/health`. Only after that succeeds does it activate/reload the validated Nginx configuration. Nginx serves `/static/` directly; other routes proxy to Gunicorn. The three AI endpoints retain Stage 1 per-IP and global concurrency limits. Quota-free smoke tests check `/health`, all six learning pages, the Bash worker, security headers and private release identity. HTTP traffic is unencrypted; do not submit secrets or sensitive tasks to the assignment site.

On activation or smoke-test failure, the playbook restores the legacy service unit and Nginx configuration on the first migration, removes the failed `current` link, restarts the old service, and checks its root page. On **later** releases it atomically restores `/opt/linuxlab/previous`, restarts Gunicorn, and restores the prior Nginx configuration if changed. It fails visibly after recovery. The old application directory is not converted into a LinuxLab release.

## 5. Identify and recover a release — server changes only when approved

Read `/opt/linuxlab/current/release.json` or `readlink /opt/linuxlab/current` for the active commit; `readlink /opt/linuxlab/previous` identifies a previous **LinuxLab** release. These metadata files are not public routes. The first successful LinuxLab deployment has no `previous` symlink; its recovery target is the preserved legacy installation, not normal release rollback.

For a **later** manual rollback after confirming `previous` exists:

```bash
sudo python3 /opt/linuxlab/tools/switch_release.py rollback --root /opt/linuxlab
sudo systemctl restart linux-explainer
sudo systemctl reload nginx
```

This swaps the versioned `current`/`previous` symlinks without mixing application files. Shared environment and Nginx configuration are outside the release tree; review them if they changed. For a **first-migration** failure, use automatic recovery first. If manual recovery is needed, confirm that `/opt/linuxlab/previous` is absent and that the saved files and old application directory exist, then run these **server-changing commands**:

```bash
sudo python3 /opt/linuxlab/tools/switch_release.py rollback --root /opt/linuxlab --allow-empty
sudo install -m 0644 -o root -g root /opt/linuxlab/legacy-recovery/linux-explainer.service /etc/systemd/system/linux-explainer.service
sudo install -m 0644 -o root -g root /opt/linuxlab/legacy-recovery/nginx.conf /etc/nginx/nginx.conf
sudo systemctl daemon-reload
sudo systemctl restart linux-explainer
sudo nginx -t
sudo systemctl reload nginx
curl --fail http://127.0.0.1/
```

The old application's `.env` is reused in place; never print or copy its contents into a release. Keep `/opt/linux-command-explainer` and its private `.env` until the first LinuxLab deployment is verified and a later release provides a normal `previous` target.

## Optional future HTTPS

HTTPS is outside this assignment deployment. A later public production upgrade would need a domain or another TLS termination method, certificate issuance and renewal, an HTTPS listener, an HTTP redirect and certificate-aware smoke tests. Consider HSTS only after HTTPS works and is verified. None is enabled here.
