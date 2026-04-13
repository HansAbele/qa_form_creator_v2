"""
Creates a git history with:
1. Branch 'stable' = exact copy of what's on the server right now
2. Branch 'master' = current local state with new analytics features

This gives the user a clean rollback point.
"""
import subprocess
import shutil
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP_DIR = os.path.join(PROJECT_ROOT, "_server_backup")


def run(cmd, **kwargs):
    print(f"  $ {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=PROJECT_ROOT, capture_output=True, text=True, **kwargs)
    if result.returncode != 0 and result.stderr:
        # Filter out warnings
        errors = [l for l in result.stderr.splitlines() if not l.startswith("warning:")]
        if errors:
            print(f"    STDERR: {chr(10).join(errors)}")
    return result


def overlay_server_files():
    """Copy server backup files over the local src/ and prisma/ to get the server state."""
    if not os.path.exists(BACKUP_DIR):
        print("ERROR: _server_backup not found. Run backup-server-state.py first.")
        return False

    # Overlay src/ from server
    server_src = os.path.join(BACKUP_DIR, "src")
    local_src = os.path.join(PROJECT_ROOT, "src")

    if os.path.exists(server_src):
        # Remove local src and replace with server version
        shutil.rmtree(local_src)
        shutil.copytree(server_src, local_src)

    # Overlay prisma/schema.prisma
    server_schema = os.path.join(BACKUP_DIR, "prisma", "schema.prisma")
    if os.path.exists(server_schema):
        shutil.copy2(server_schema, os.path.join(PROJECT_ROOT, "prisma", "schema.prisma"))

    # Overlay individual config files
    for f in ["package.json", "next.config.ts", "Dockerfile", "docker-compose.prod.yml",
              "tsconfig.json", "biome.json", "components.json", "postcss.config.mjs"]:
        server_f = os.path.join(BACKUP_DIR, f)
        if os.path.exists(server_f):
            shutil.copy2(server_f, os.path.join(PROJECT_ROOT, f))

    return True


def main():
    print("=== Creating Git Backup ===\n")

    # Step 1: Stash current state by saving a copy
    print("[1/5] Saving current local state...")
    local_save = os.path.join(PROJECT_ROOT, "_local_save")
    if os.path.exists(local_save):
        shutil.rmtree(local_save)

    # Save src/, prisma/schema.prisma, and config files
    shutil.copytree(os.path.join(PROJECT_ROOT, "src"), os.path.join(local_save, "src"))
    os.makedirs(os.path.join(local_save, "prisma"), exist_ok=True)
    shutil.copy2(os.path.join(PROJECT_ROOT, "prisma", "schema.prisma"),
                 os.path.join(local_save, "prisma", "schema.prisma"))
    for f in ["package.json", "next.config.ts", "Dockerfile", "docker-compose.prod.yml"]:
        src = os.path.join(PROJECT_ROOT, f)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(local_save, f))

    # Step 2: Overlay server files and commit as 'stable'
    print("[2/5] Overlaying server files for stable commit...")
    if not overlay_server_files():
        return

    run("git add -A")
    run('git commit -m "chore: stable server state — production backup before analytics\n\nExact copy of deployed code on 192.168.80.243.\nUse this commit/branch to rollback if needed.\n\nCo-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"')

    # Step 3: Create 'stable' branch/tag at this commit
    print("[3/5] Creating 'stable' branch...")
    run("git branch stable")
    run("git tag v1.0-stable -m \"Last known working state before analytics features\"")

    # Step 4: Restore local state with new features
    print("[4/5] Restoring local state with analytics features...")
    # Restore src/
    local_src = os.path.join(PROJECT_ROOT, "src")
    shutil.rmtree(local_src)
    shutil.copytree(os.path.join(local_save, "src"), local_src)

    # Restore prisma/schema.prisma
    shutil.copy2(os.path.join(local_save, "prisma", "schema.prisma"),
                 os.path.join(PROJECT_ROOT, "prisma", "schema.prisma"))

    # Restore config files
    for f in ["package.json", "next.config.ts", "Dockerfile", "docker-compose.prod.yml"]:
        src = os.path.join(local_save, f)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(PROJECT_ROOT, f))

    # Step 5: Commit new analytics features
    print("[5/5] Committing analytics features...")
    run("git add -A")
    run('git commit -m "feat: teams, dispositions, drill-down analytics, and expanded QA permissions\n\n- New Prisma models: Team, DispositionCategory, Disposition\n- Agent now has optional teamId, Response has dispositionId\n- Disposition combobox with fuzzy anti-typo matching and inline creation\n- Admin pages for teams and dispositions (CRUD + bulk import)\n- QA role expanded: can now create/edit forms, agents, dispositions\n- 5 new analytics queries: team perf, disposition analytics, agent/evaluator/team detail\n- Dashboard: 2 new charts (teams + dispositions) + all charts clickable for drill-down\n- 5 new drill-down pages: /agents/[id], /evaluators/[id], /teams/[id], /teams, /dispositions\n- Sidebar updated with Equipos and Disposiciones navigation\n- ADMIN displayed as QA Manager in UI\n\nCo-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"')

    # Cleanup
    shutil.rmtree(local_save)
    shutil.rmtree(BACKUP_DIR)

    print("\n=== Done ===")
    print("  Branch 'master'  → current state with analytics features")
    print("  Branch 'stable'  → server state before changes (rollback point)")
    print("  Tag 'v1.0-stable' → same as stable branch")
    print("\n  To rollback: git checkout stable")
    print("  To see diff: git diff stable..master")


if __name__ == "__main__":
    main()
