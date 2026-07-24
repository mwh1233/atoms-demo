import asyncio
import mimetypes
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import httpx

from app.db.supabase_client import supabase


DEPLOY_BUCKET = "deployed-projects"
FULLSTACK_TEMPLATES = {"fullstack-agent", "fullstack-shadcn"}
BUILD_TIMEOUT_SECONDS = 120
TEMP_PROJECT_ROOT = Path("temp_projects")


def _preview_url(project_id: str, file_path: str = "index.html") -> str:
    return f"http://localhost:8000/api/preview/{project_id}/{file_path}"


async def deploy_project(
    project_id: str,
    template_id: str,
    generated_files: dict[str, str] | None = None,
    generated_code: str | None = None,
) -> str:
    generated_files = generated_files or {}
    print(f"[deploy] template_id={template_id}, using fullstack mock={template_id in FULLSTACK_TEMPLATES}")

    if template_id in FULLSTACK_TEMPLATES:
        return await _deploy_fullstack_mock(project_id, generated_files)

    return await _deploy_simple_html(project_id, generated_files, generated_code)


async def _deploy_simple_html(
    project_id: str,
    generated_files: dict[str, str],
    generated_code: str | None = None,
) -> str:
    html_code = (
        generated_code
        or generated_files.get("index.html")
        or generated_files.get("frontend/index.html")
        or ""
    )
    return await _upload_preview_page(project_id, html_code)


async def _deploy_fullstack_mock(project_id: str, generated_files: dict[str, str]) -> str:
    """
    Fullstack mock deployment:
    1. Write frontend files into a temp directory.
    2. Inject a fetch mock before build.
    3. Run npm install and npm run build asynchronously.
    4. Upload dist assets to Storage.
    5. Fall back to an explanatory static page when build is unavailable.
    """
    node_env_available = _check_node_env()
    print(f"[deploy] node env available: {node_env_available}")
    if not node_env_available:
        print("[deploy] fullstack mock build skipped: node env unavailable")
        return await _deploy_fullstack_fallback(
            project_id,
            "This project is a fullstack app. The current environment does not support online preview, please download the code and run it locally.",
        )

    frontend_files = _extract_frontend_files(generated_files)
    print(f"[DEPLOY] frontend files count: {len(frontend_files)}")
    print(f"[DEPLOY] frontend file keys: {list(frontend_files.keys())[:20]}")
    index_content = frontend_files.get("src/pages/Index.tsx", "NOT FOUND")
    print(f"[DEPLOY] Index.tsx preview: {index_content[:300]}")
    if not frontend_files:
        print("[deploy] fullstack mock build skipped: no frontend files")
        return await _deploy_fullstack_fallback(
            project_id,
            "No frontend files were generated for this fullstack project.",
        )

    temp_dir = TEMP_PROJECT_ROOT / project_id
    try:
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        temp_dir.mkdir(parents=True, exist_ok=True)

        _write_project_files(temp_dir, frontend_files)
        _inject_mock_script(temp_dir / "index.html")
        _force_vite_relative_base(temp_dir / "vite.config.ts")

        # Debug: verify index.html after injection
        index_after = (temp_dir / "index.html").read_text(encoding="utf-8")
        print(f"[deploy] index.html after mock injection ({len(index_after)} chars):")
        print(index_after[:800])

        # Debug: verify vite.config.ts after patching
        vite_config = (temp_dir / "vite.config.ts").read_text(encoding="utf-8")
        print(f"[deploy] vite.config.ts base check: base:'./' present = {'base: ' + chr(39) + './' + chr(39) in vite_config}")

        install_command = _npm_command("install")
        print(f"[deploy] running command: {install_command}")
        install_result = await _run_command(install_command, temp_dir)
        if install_result.returncode != 0:
            print(f"[deploy] npm install failed: {install_result.stderr or install_result.stdout}")
            return await _deploy_fullstack_fallback(
                project_id,
                f"npm install failed:\n{install_result.stderr or install_result.stdout}",
            )
        print("[deploy] npm install succeeded")

        build_command = _npm_command("run", "build", "--", "--base=./")
        print(f"[deploy] running command: {build_command}")
        build_result = await _run_command(build_command, temp_dir)
        if build_result.returncode != 0:
            print(f"[deploy] npm run build failed: {build_result.stderr or build_result.stdout}")
            return await _deploy_fullstack_fallback(
                project_id,
                f"npm run build failed:\n{build_result.stderr or build_result.stdout}",
            )
        print("[deploy] npm run build succeeded")

        dist_dir = temp_dir / "dist"
        if not dist_dir.exists():
            print("[deploy] build completed but dist directory was not found")
            return await _deploy_fullstack_fallback(
                project_id,
                "Build completed but dist directory was not found.",
            )

        # Debug: print dist files and index.html content
        dist_files = list(dist_dir.rglob("*"))
        print(f"[deploy] dist files ({len(dist_files)}):")
        for f in dist_files[:20]:
            if f.is_file():
                print(f"  - {f.relative_to(dist_dir)} ({f.stat().st_size} bytes)")

        dist_index = dist_dir / "index.html"
        if dist_index.exists():
            dist_html = dist_index.read_text(encoding="utf-8")
            print(f"[deploy] dist/index.html ({len(dist_html)} chars):")
            print(dist_html[:1500])
        else:
            print("[deploy] WARNING: dist/index.html not found!")

        await _upload_directory(project_id, dist_dir)
        deploy_url = _preview_url(project_id)
        await _mark_deploy_success(project_id, deploy_url)
        return deploy_url
    except Exception as exc:
        import traceback

        error_detail = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
        print(f"[deploy] fullstack mock failed with exception:\n{error_detail}")
        return await _deploy_fullstack_fallback(project_id, f"Preview build failed: {exc}")
    finally:
        if temp_dir.exists():
            shutil.rmtree(temp_dir, ignore_errors=True)


def _check_node_env() -> bool:
    """Check whether Node.js and npm are available for fullstack preview builds."""
    try:
        if os.name == "nt":
            node = subprocess.run(["where", "node"], capture_output=True, timeout=5)
            npm = subprocess.run(["where", "npm"], capture_output=True, timeout=5)
        else:
            node = subprocess.run(["which", "node"], capture_output=True, timeout=5)
            npm = subprocess.run(["which", "npm"], capture_output=True, timeout=5)
        return node.returncode == 0 and npm.returncode == 0
    except Exception:
        return False


def _npm_command(*args: str) -> tuple[str, ...]:
    """Build a Windows-safe npm command tuple."""
    if os.name != "nt":
        return ("npm", *args)

    npm_path = shutil.which("npm.cmd") or shutil.which("npm") or "npm"
    return ("cmd.exe", "/c", npm_path, *args)


def _extract_frontend_files(generated_files: dict[str, str]) -> dict[str, str]:
    files: dict[str, str] = {}
    for path, content in generated_files.items():
        normalized = path.strip().replace("\\", "/").lstrip("/")
        if normalized.startswith("frontend/"):
            files[normalized.removeprefix("frontend/")] = content
        elif normalized in {"index.html", "package.json", "vite.config.ts", "vite.config.js"}:
            files[normalized] = content
        elif normalized.startswith(("src/", "public/")):
            files[normalized] = content
    return files


def _write_project_files(root: Path, files: dict[str, str]) -> None:
    for relative_path, content in files.items():
        target = root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")


def _inject_mock_script(index_path: Path) -> None:
    if not index_path.exists():
        index_path.write_text(
            '<!doctype html><html><head><meta charset="utf-8"><title>Preview</title></head><body><div id="root"></div></body></html>',
            encoding="utf-8",
        )

    html = index_path.read_text(encoding="utf-8")
    if "// [Atoms Mock Guard]" in html:
        return

    guard_script = """<script>
// [Atoms Mock Guard] Early injection - intercept fetch and catch errors
(function() {
  // 1. Mock fetch - safe defaults for any API call
  var originalFetch = window.fetch;
  window.fetch = function(url, options) {
    var target = String(url);
    if (target.indexOf('/api/') !== -1 || target.indexOf(':8000/') !== -1 || target.indexOf(':3000/') !== -1) {
      console.log('[Mock] intercepted:', target);
      return Promise.resolve(new Response(JSON.stringify({
        code: 0, message: 'mock',
        data: { list: [], items: [], products: [], records: [], total: 0, user: {}, banners: [], categories: [], config: {} }
      }), { headers: { 'Content-Type': 'application/json' }, status: 200 }));
    }
    return originalFetch.apply(this, arguments);
  };

  // 2. Global error handler - show error on screen instead of white screen
  function showError(msg) {
    var existing = document.getElementById('__atoms_error__');
    if (existing) return;
    var div = document.createElement('div');
    div.id = '__atoms_error__';
    div.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#fff;padding:40px;font-family:system-ui,sans-serif;z-index:99999;overflow:auto;box-sizing:border-box;';
    div.innerHTML = '<div style="max-width:800px;margin:0 auto;"><h2 style="color:#ef4444;margin:0 0 16px;font-size:20px;">预览运行时错误</h2><pre style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;color:#991b1b;font-size:13px;white-space:pre-wrap;line-height:1.5;">' + String(msg).replace(/</g,'&lt;') + '</pre><p style="color:#666;margin-top:16px;font-size:14px;">这是运行时错误，不影响代码生成，可以继续迭代修复。</p></div>';
    document.body.appendChild(div);
  }

  window.addEventListener('error', function(e) {
    console.error('[Preview Error]', e.error || e.message);
    showError(e.message + '\\n\\n' + (e.error && e.error.stack ? e.error.stack : ''));
  });
  window.addEventListener('unhandledrejection', function(e) {
    console.error('[Preview Unhandled]', e.reason);
    showError('Unhandled Promise Rejection: ' + (e.reason && e.reason.stack ? e.reason.stack : e.reason));
  });

  // 3. Timeout check - if root is empty after 5s, log warning
  setTimeout(function() {
    var root = document.getElementById('root');
    if (root && (!root.hasChildNodes() || root.innerHTML.trim() === '')) {
      console.warn('[Preview] root is empty after 5s');
    }
  }, 5000);
})();
</script>"""
    # Inject in <head> for earliest execution
    if "<head>" in html:
        html = html.replace("<head>", "<head>" + guard_script, 1)
    elif "<head " in html:
        html = html.replace("<head ", guard_script + "<head ", 1)
    else:
        html = guard_script + html

    index_path.write_text(html, encoding="utf-8")


def _force_vite_relative_base(config_path: Path) -> None:
    """Force relative asset paths and remove atoms platform-only preview plugins."""
    if not config_path.exists():
        return

    config = config_path.read_text(encoding="utf-8")
    if "base:" in config:
        config = re.sub(r"base\s*:\s*['\"`][^'\"`]*['\"`]\s*,?", "base: './',", config, count=1)
    else:
        config = config.replace("defineConfig({", "defineConfig({\n  base: './',", 1)

    # Remove atoms platform plugins; atoms() injects the "Not built yet" placeholder.
    config = config.replace("    atoms(),", "    // atoms(),")
    config = re.sub(r"\s+viteSourceLocator\(\{[\s\S]*?\}\),", "", config)

    config_path.write_text(config, encoding="utf-8")
    print("[deploy] patched vite.config.ts base and removed atoms preview plugins")


async def _run_command(command: tuple[str, ...], cwd: Path) -> subprocess.CompletedProcess:
    """Run a shell command in a thread to avoid Windows asyncio subprocess issues."""

    def _run():
        return subprocess.run(
            command,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=BUILD_TIMEOUT_SECONDS,
        )

    try:
        return await asyncio.to_thread(_run)
    except subprocess.TimeoutExpired as exc:
        return subprocess.CompletedProcess(
            command,
            124,
            exc.stdout or "",
            exc.stderr or "Command timed out",
        )
    except FileNotFoundError as exc:
        return subprocess.CompletedProcess(
            command,
            127,
            "",
            f"Command not found: {exc}",
        )


async def _upload_directory(project_id: str, directory: Path) -> None:
    content_type_map = {
        ".html": "text/html",
        ".htm": "text/html",
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".ico": "image/x-icon",
        ".webp": "image/webp",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".map": "application/json",
        ".txt": "text/plain",
    }

    for file_path in directory.rglob("*"):
        if not file_path.is_file():
            continue

        relative_path = file_path.relative_to(directory).as_posix()
        storage_path = f"projects/{project_id}/{relative_path}"
        suffix = file_path.suffix.lower()
        content_type = content_type_map.get(suffix)
        if not content_type:
            content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        file_content = file_path.read_bytes()
        await _upload_file_raw(storage_path, file_content, content_type)


async def _deploy_fullstack_fallback(project_id: str, message: str) -> str:
    escaped_message = (
        message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )
    html_code = f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Preview unavailable</title>
    <style>
      body {{
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0f172a;
        color: #e5e7eb;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }}
      main {{
        max-width: 720px;
        padding: 40px;
        line-height: 1.7;
      }}
      h1 {{ margin: 0 0 12px; font-size: 24px; }}
      pre {{
        white-space: pre-wrap;
        color: #cbd5e1;
        background: #111827;
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 8px;
        padding: 16px;
      }}
    </style>
  </head>
  <body>
    <main>
      <h1>该项目暂时无法在线预览</h1>
      <pre>{escaped_message}</pre>
    </main>
  </body>
</html>"""
    return await _upload_preview_page(project_id, html_code, deploy_status="failed")


async def _upload_preview_page(
    project_id: str,
    html_code: str,
    deploy_status: str = "success",
) -> str:
    file_path = f"projects/{project_id}/index.html"
    file_content = html_code.encode("utf-8")
    await _upload_file_raw(file_path, file_content, "text/html")

    deploy_url = _preview_url(project_id)
    await _mark_deploy_success(project_id, deploy_url, deploy_status)
    return deploy_url


async def _upload_file_raw(file_path: str, file_content: bytes, content_type: str) -> None:
    """直接用 HTTP PUT 上传文件，精确控制 Content-Type。"""
    from app.config import settings

    url = f"{settings.supabase_url}/storage/v1/object/{DEPLOY_BUCKET}/{file_path}"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "x-upsert": "true",
        "Cache-Control": "no-cache",
    }
    filename = Path(file_path).name

    await _remove_storage_object(file_path)

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            url,
            files={"file": (filename, file_content, content_type)},
            data={"cacheControl": "no-cache"},
            headers=headers,
        )

    print(
        f"[UPLOAD RAW] path={file_path}, method=POST multipart, "
        f"content_type={content_type}, status={response.status_code}"
    )

    if response.status_code >= 400:
        print(f"[UPLOAD RAW ERROR] response body: {response.text}")
        response.raise_for_status()


async def _remove_storage_object(storage_path: str) -> None:
    try:
        await asyncio.to_thread(
            supabase.storage.from_(DEPLOY_BUCKET).remove,
            [storage_path],
        )
    except Exception:
        pass


async def _mark_deploy_success(
    project_id: str,
    public_url: str,
    deploy_status: str = "success",
) -> None:
    await asyncio.to_thread(
        lambda: supabase.table("projects")
        .update(
            {
                "deploy_status": deploy_status,
                "deployed_url": public_url,
                "deployed_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", project_id)
        .execute()
    )
