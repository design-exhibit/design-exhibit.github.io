#!/usr/bin/env python3
"""检测项目 Excel，并在确认后提交到 GitHub。"""

from __future__ import annotations

import hashlib
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, scrolledtext, ttk
except ImportError as error:  # GitHub Actions只测试后端，不需要图形组件。
    tk = filedialog = messagebox = scrolledtext = ttk = None
    TKINTER_IMPORT_ERROR = error
else:
    TKINTER_IMPORT_ERROR = None


TOOL_DIRECTORY = Path(__file__).resolve().parent
REPOSITORY_ROOT = TOOL_DIRECTORY.parent
SCRIPTS_DIRECTORY = REPOSITORY_ROOT / "scripts"
if str(SCRIPTS_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIRECTORY))

from excel_to_json import parse_workbook  # noqa: E402


DATA_RELATIVE_PATH = Path("data") / "项目链接清单.xlsx"
DATA_PATH = REPOSITORY_ROOT / DATA_RELATIVE_PATH
EXPECTED_REPOSITORY = "design-exhibit/design-exhibit.github.io"
WEBSITE_URL = "https://design-exhibit.github.io/"
COMMIT_PREFIX = "更新项目数据表 "
REMOTE_PATTERN = re.compile(
    r"^(?:git@github\.com:|ssh://git@github\.com/|https://github\.com/)"
    r"design-exhibit/design-exhibit\.github\.io(?:\.git)?/?$",
    re.IGNORECASE,
)


class UploadError(Exception):
    """上传前检查或 Git 操作失败。"""


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_snapshot(path: Path) -> tuple[dict, str]:
    payload = parse_workbook(path)
    return payload, file_digest(path)


def validate_workbook(path: Path) -> tuple[dict, str]:
    if not path.is_file():
        raise UploadError("选择的数据表不存在")
    if path.suffix.lower() != ".xlsx":
        raise UploadError("只支持 .xlsx 格式的数据表")
    with tempfile.TemporaryDirectory(prefix="project-check-") as directory:
        snapshot = Path(directory) / path.name
        shutil.copy2(path, snapshot)
        payload, digest = _validate_snapshot(snapshot)
    if file_digest(path) != digest:
        raise UploadError("数据表在检测过程中发生了变化，请重新检测")
    return payload, digest


def workbook_summary(payload: dict) -> dict[str, int]:
    projects = payload.get("projects", [])
    return {
        "projects": len(projects),
        "images": sum(
            bool(project.get("simulationImage")) + bool(project.get("hardwareImage"))
            for project in projects
        ),
        "priced": sum(bool(project.get("prices")) for project in projects),
    }


def is_expected_remote(remote: str) -> bool:
    return REMOTE_PATTERN.fullmatch(remote.strip().replace("\\", "/")) is not None


def run_git(
    *arguments: str,
    check: bool = True,
    timeout: int = 30,
) -> subprocess.CompletedProcess:
    executable = shutil.which("git")
    if not executable:
        raise UploadError("没有找到 Git，请先安装 Git for Windows")
    environment = os.environ.copy()
    environment["GIT_TERMINAL_PROMPT"] = "0"
    creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        result = subprocess.run(
            [executable, *arguments],
            cwd=REPOSITORY_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=environment,
            timeout=timeout,
            creationflags=creation_flags,
        )
    except subprocess.TimeoutExpired as error:
        raise UploadError("Git 操作超时，请检查网络后重试") from error
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise UploadError(detail or f"Git 操作失败：{' '.join(arguments)}")
    return result


def git_paths(*arguments: str) -> set[str]:
    output = run_git("-c", "core.quotePath=false", *arguments, "-z").stdout
    return {path.replace("\\", "/") for path in output.split("\0") if path}


def pending_upload_commits() -> list[str]:
    commits = [
        commit
        for commit in run_git("rev-list", "--reverse", "origin/main..HEAD").stdout.splitlines()
        if commit
    ]
    for commit in commits:
        subject = run_git("show", "-s", "--format=%s", commit).stdout.strip()
        paths = git_paths(
            "diff-tree", "--root", "--no-commit-id", "--name-only", "-r", commit
        )
        if not subject.startswith(COMMIT_PREFIX) or paths != {DATA_RELATIVE_PATH.as_posix()}:
            raise UploadError(
                "本地 main 存在并非由上传工具创建的待推送提交，已停止上传：\n"
                f"{commit[:8]} {subject}"
            )
    return commits


def check_repository(log: Callable[[str], None]) -> None:
    root = Path(run_git("rev-parse", "--show-toplevel").stdout.strip()).resolve()
    if root != REPOSITORY_ROOT.resolve():
        raise UploadError("上传工具不在目标 Git 仓库内")
    branch = run_git("branch", "--show-current").stdout.strip()
    if branch != "main":
        raise UploadError(f"当前分支是 {branch or '未知'}，请切换到 main 后重试")
    fetch_urls = run_git("remote", "get-url", "--all", "origin").stdout.splitlines()
    push_urls = run_git(
        "remote", "get-url", "--push", "--all", "origin"
    ).stdout.splitlines()
    invalid_urls = [url for url in [*fetch_urls, *push_urls] if not is_expected_remote(url)]
    if not fetch_urls or not push_urls or invalid_urls:
        detail = invalid_urls[0] if invalid_urls else "未配置"
        raise UploadError(f"origin 不是目标 GitHub 仓库：{detail}")

    staged = git_paths("diff", "--cached", "--name-only")
    allowed = {DATA_RELATIVE_PATH.as_posix()}
    unrelated = sorted(staged - allowed)
    if unrelated:
        raise UploadError("存在其他已暂存文件，已停止上传：\n" + "\n".join(unrelated))

    log("正在检查 GitHub 远程状态……")
    run_git("fetch", "origin", timeout=120)
    counts = run_git(
        "rev-list", "--left-right", "--count", "origin/main...HEAD"
    ).stdout.split()
    if len(counts) != 2:
        raise UploadError("无法判断本地与 GitHub 的同步状态")
    behind, _ahead = (int(value) for value in counts)
    if behind:
        raise UploadError(
            "GitHub 上存在本地没有的新提交。为避免覆盖数据，请先同步仓库后再上传。"
        )
    pending_upload_commits()


def install_snapshot(snapshot: Path, digest: str, log: Callable[[str], None]) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    backup_directory = REPOSITORY_ROOT / "1" / "上传前备份"
    backup_directory.mkdir(parents=True, exist_ok=True)
    if DATA_PATH.exists():
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        backup = backup_directory / f"项目链接清单_{timestamp}.xlsx"
        shutil.copy2(DATA_PATH, backup)
        log(f"原数据表已备份到：{backup.relative_to(REPOSITORY_ROOT)}")

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".project-upload-", suffix=".xlsx", dir=DATA_PATH.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        shutil.copy2(snapshot, temporary)
        if file_digest(temporary) != digest:
            raise UploadError("写入临时数据表时校验失败，正式文件未被替换")
        os.replace(str(temporary), str(DATA_PATH))
    finally:
        if temporary.exists():
            temporary.unlink()
    if file_digest(DATA_PATH) != digest:
        raise UploadError("正式数据表替换后校验失败，已停止上传")
    log("已原子替换项目数据表")


def upload_workbook(
    source: Path,
    expected_digest: str,
    log: Callable[[str], None],
) -> dict:
    if not source.is_file():
        raise UploadError("选择的数据表不存在，请重新选择")
    with tempfile.TemporaryDirectory(prefix="project-upload-") as directory:
        snapshot = Path(directory) / source.name
        shutil.copy2(source, snapshot)
        log("正在校验待上传快照……")
        payload, current_digest = _validate_snapshot(snapshot)
        if current_digest != expected_digest or file_digest(source) != current_digest:
            raise UploadError("数据表在检测后发生了变化，请重新检测")

        check_repository(log)
        if file_digest(source) != current_digest:
            raise UploadError("数据表在上传准备期间发生了变化，请重新检测")
        install_snapshot(snapshot, current_digest, log)

    run_git("add", "--", DATA_RELATIVE_PATH.as_posix())
    changed = run_git(
        "diff", "--cached", "--quiet", "--", DATA_RELATIVE_PATH.as_posix(), check=False
    )
    if changed.returncode not in {0, 1}:
        raise UploadError("无法确认数据表是否发生变化")
    if changed.returncode == 1:
        message = f"{COMMIT_PREFIX}{datetime.now():%Y-%m-%d %H:%M}"
        run_git("commit", "-m", message)
        log("已创建 Git 提交")
    else:
        log("数据表与当前提交一致，将检查是否有待推送提交")

    pending_upload_commits()
    log("正在推送唯一的数据表提交到 GitHub……")
    push = run_git("push", "origin", "main", timeout=120)
    output = (push.stderr or push.stdout).strip()
    if output:
        log(output)
    return payload


class UploadApplication:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.selected_path: Optional[Path] = DATA_PATH if DATA_PATH.exists() else None
        self.validated_digest = ""
        self.busy = False
        self.events = queue.Queue()

        root.title("课题库数据表上传工具")
        root.geometry("820x620")
        root.minsize(720, 520)
        root.configure(background="#f3f6f8")

        self.path_variable = tk.StringVar(
            value=str(self.selected_path) if self.selected_path else "尚未选择数据表"
        )
        self.status_variable = tk.StringVar(value="等待检测")

        self._configure_styles()
        self._build_interface()
        self.root.protocol("WM_DELETE_WINDOW", self.request_close)
        self.root.after(80, self._drain_events)
        if self.selected_path:
            self._append_log("已定位当前项目数据表，请点击“检测数据表”。")

    def _configure_styles(self) -> None:
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Primary.TButton", padding=(18, 10), font=("Microsoft YaHei UI", 10, "bold"))
        style.configure("Secondary.TButton", padding=(14, 9), font=("Microsoft YaHei UI", 10))
        style.configure("Upload.Horizontal.TProgressbar", troughcolor="#dfe7ec", background="#118b86")

    def _build_interface(self) -> None:
        header = tk.Frame(self.root, background="#0b2036", height=92)
        header.pack(fill="x")
        header.pack_propagate(False)
        tk.Label(
            header,
            text="课题库数据表上传工具",
            background="#0b2036",
            foreground="#ffffff",
            font=("Microsoft YaHei UI", 19, "bold"),
        ).pack(anchor="w", padx=28, pady=(18, 2))
        tk.Label(
            header,
            text="Excel 检测通过后才能上传到 GitHub",
            background="#0b2036",
            foreground="#a9bdcc",
            font=("Microsoft YaHei UI", 10),
        ).pack(anchor="w", padx=29)

        body = tk.Frame(self.root, background="#f3f6f8")
        body.pack(fill="both", expand=True, padx=26, pady=20)
        body.columnconfigure(0, weight=1)
        body.rowconfigure(3, weight=1)

        tk.Label(
            body,
            text="数据表",
            background="#f3f6f8",
            foreground="#24384c",
            font=("Microsoft YaHei UI", 10, "bold"),
        ).grid(row=0, column=0, sticky="w", pady=(0, 7))

        file_row = tk.Frame(body, background="#f3f6f8")
        file_row.grid(row=1, column=0, sticky="ew")
        file_row.columnconfigure(0, weight=1)
        self.path_entry = ttk.Entry(file_row, textvariable=self.path_variable, state="readonly")
        self.path_entry.grid(row=0, column=0, sticky="ew", ipady=8)
        self.select_button = ttk.Button(
            file_row, text="选择数据表", style="Secondary.TButton", command=self.select_file
        )
        self.select_button.grid(row=0, column=1, padx=(10, 0))
        self.detect_button = ttk.Button(
            file_row, text="检测数据表", style="Primary.TButton", command=self.start_validation
        )
        self.detect_button.grid(row=0, column=2, padx=(8, 0))

        status_row = tk.Frame(body, background="#f3f6f8")
        status_row.grid(row=2, column=0, sticky="ew", pady=(14, 10))
        self.status_label = tk.Label(
            status_row,
            textvariable=self.status_variable,
            background="#f3f6f8",
            foreground="#6a7886",
            font=("Microsoft YaHei UI", 10, "bold"),
        )
        self.status_label.pack(side="left")
        self.progress = ttk.Progressbar(
            status_row, mode="indeterminate", length=180, style="Upload.Horizontal.TProgressbar"
        )
        self.progress.pack(side="right")

        log_frame = tk.Frame(body, background="#f3f6f8")
        log_frame.grid(row=3, column=0, sticky="nsew")
        tk.Label(
            log_frame,
            text="检测与上传日志",
            background="#f3f6f8",
            foreground="#24384c",
            font=("Microsoft YaHei UI", 10, "bold"),
        ).pack(anchor="w", pady=(0, 7))
        self.log_text = scrolledtext.ScrolledText(
            log_frame,
            wrap="word",
            height=15,
            state="disabled",
            background="#101c29",
            foreground="#dce8ef",
            insertbackground="#ffffff",
            selectbackground="#276f77",
            borderwidth=0,
            padx=13,
            pady=12,
            font=("Microsoft YaHei UI", 10),
        )
        self.log_text.pack(fill="both", expand=True)

        action_row = tk.Frame(body, background="#f3f6f8")
        action_row.grid(row=4, column=0, sticky="ew", pady=(16, 0))
        self.upload_button = ttk.Button(
            action_row,
            text="上传到 GitHub",
            style="Primary.TButton",
            command=self.confirm_upload,
            state="disabled",
        )
        self.upload_button.pack(side="right")

    def _append_log(self, message: str) -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"[{timestamp}] {message}\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _post(self, callback: Callable, *arguments: object) -> None:
        self.events.put((callback, arguments))

    def _drain_events(self) -> None:
        try:
            while True:
                callback, arguments = self.events.get_nowait()
                callback(*arguments)
        except queue.Empty:
            pass
        self.root.after(80, self._drain_events)

    def _thread_log(self, message: str) -> None:
        self._post(self._append_log, message)

    def _set_status(self, text: str, color: str) -> None:
        self.status_variable.set(text)
        self.status_label.configure(foreground=color)

    def _set_busy(self, busy: bool) -> None:
        self.busy = busy
        state = "disabled" if busy else "normal"
        self.select_button.configure(state=state)
        self.detect_button.configure(state=state)
        if busy:
            self.upload_button.configure(state="disabled")
            self.progress.start(12)
        else:
            self.progress.stop()
            if self.validated_digest:
                self.upload_button.configure(state="normal")

    def request_close(self) -> None:
        if self.busy:
            messagebox.showwarning("任务进行中", "检测或上传尚未完成，请完成后再关闭窗口。")
            return
        self.root.destroy()

    def select_file(self) -> None:
        filename = filedialog.askopenfilename(
            title="选择项目数据表",
            initialdir=str(DATA_PATH.parent),
            filetypes=[("Excel 数据表", "*.xlsx")],
        )
        if not filename:
            return
        self.selected_path = Path(filename)
        self.path_variable.set(filename)
        self.validated_digest = ""
        self.upload_button.configure(state="disabled")
        self._set_status("等待检测", "#6a7886")
        self._append_log(f"已选择：{filename}")

    def start_validation(self) -> None:
        if self.busy:
            return
        if self.selected_path is None:
            messagebox.showwarning("尚未选择", "请先选择一个 .xlsx 数据表")
            return
        self.validated_digest = ""
        self._set_busy(True)
        self._set_status("正在检测……", "#8a640f")
        self._append_log("开始检测数据表……")
        threading.Thread(target=self._validation_worker, daemon=False).start()

    def _validation_worker(self) -> None:
        try:
            payload, digest = validate_workbook(self.selected_path)
            summary = workbook_summary(payload)
        except Exception as error:
            self._post(self._validation_failed, str(error))
            return
        self._post(self._validation_succeeded, digest, summary)

    def _validation_failed(self, detail: str) -> None:
        self.validated_digest = ""
        self._set_busy(False)
        self._set_status("检测失败", "#b3261e")
        self._append_log("发现问题：")
        self._append_log(detail)

    def _validation_succeeded(self, digest: str, summary: dict[str, int]) -> None:
        self.validated_digest = digest
        self._set_busy(False)
        self._set_status("检测通过，可以上传", "#19703d")
        self._append_log(
            f"检测通过：{summary['projects']} 个项目，{summary['images']} 张图片，"
            f"{summary['priced']} 个项目有可选价格。"
        )

    def confirm_upload(self) -> None:
        if self.busy or not self.validated_digest or self.selected_path is None:
            return
        confirmed = messagebox.askyesno(
            "确认上传",
            "数据表检测已通过。\n\n"
            "确认提交并推送到 GitHub 吗？\n"
            f"发布网站：{WEBSITE_URL}",
            icon="question",
        )
        if not confirmed:
            self._append_log("已取消上传。")
            return
        self._set_busy(True)
        self._set_status("正在上传……", "#8a640f")
        threading.Thread(target=self._upload_worker, daemon=False).start()

    def _upload_worker(self) -> None:
        try:
            payload = upload_workbook(
                self.selected_path, self.validated_digest, self._thread_log
            )
            summary = workbook_summary(payload)
        except Exception as error:
            self._post(self._upload_failed, str(error))
            return
        self._post(self._upload_succeeded, summary)

    def _upload_failed(self, detail: str) -> None:
        self.validated_digest = ""
        self._set_busy(False)
        self._set_status("上传失败", "#b3261e")
        self._append_log("上传失败：")
        self._append_log(detail)
        self._append_log("请重新检测数据表后再上传。")

    def _upload_succeeded(self, summary: dict[str, int]) -> None:
        self._set_busy(False)
        self.upload_button.configure(state="disabled")
        self._set_status("上传成功", "#19703d")
        self._append_log(
            f"上传成功：{summary['projects']} 个项目。GitHub 正在自动发布网页。"
        )
        messagebox.showinfo(
            "上传成功",
            "数据表已推送到 GitHub。\n网页通常会在 1～3 分钟内自动更新。",
        )


def main() -> None:
    if TKINTER_IMPORT_ERROR is not None:
        raise SystemExit(f"无法启动图形界面：{TKINTER_IMPORT_ERROR}")
    root = tk.Tk()
    UploadApplication(root)
    root.mainloop()


if __name__ == "__main__":
    main()
