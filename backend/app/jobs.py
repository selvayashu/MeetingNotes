"""In-memory background jobs for long tasks (full transcription, diarization, notes).

Long requests are fragile behind proxies and on mobile networks, so the client starts a job
and polls GET /api/jobs/{id}. Jobs live in memory; a restart loses them and the client retries.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from .config import settings

log = logging.getLogger("meetnotes.jobs")


@dataclass
class Job:
    kind: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: str = "queued"  # queued | running | done | error
    progress: float = 0.0
    result: Optional[Any] = None
    error: Optional[str] = None
    created: float = field(default_factory=time.time)

    def public(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "progress": round(self.progress, 3),
            "result": self.result,
            "error": self.error,
        }

    def set_progress(self, value: float) -> None:
        self.progress = max(0.0, min(1.0, value))


class JobStore:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self.executor = ThreadPoolExecutor(max_workers=max(1, settings.job_workers), thread_name_prefix="job")
        self._tasks: set[asyncio.Task] = set()

    def _cleanup(self) -> None:
        cutoff = time.time() - settings.job_ttl_seconds
        for job_id in [j.id for j in self.jobs.values() if j.created < cutoff and j.status in ("done", "error")]:
            self.jobs.pop(job_id, None)

    def create(self, kind: str) -> Job:
        self._cleanup()
        job = Job(kind)
        self.jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Optional[Job]:
        return self.jobs.get(job_id)

    def delete(self, job_id: str) -> None:
        self.jobs.pop(job_id, None)

    def run_sync(self, job: Job, fn: Callable[[Job], Any], cleanup: Optional[Callable[[], None]] = None) -> None:
        def wrapper() -> None:
            job.status = "running"
            try:
                job.result = fn(job)
                job.progress = 1.0
                job.status = "done"
            except Exception as exc:  # noqa: BLE001
                log.exception("%s job failed", job.kind)
                job.error = str(exc) or exc.__class__.__name__
                job.status = "error"
            finally:
                if cleanup:
                    cleanup()

        self.executor.submit(wrapper)

    def run_async(self, job: Job, fn: Callable[[Job], Awaitable[Any]]) -> None:
        async def wrapper() -> None:
            job.status = "running"
            try:
                job.result = await fn(job)
                job.progress = 1.0
                job.status = "done"
            except Exception as exc:  # noqa: BLE001
                log.exception("%s job failed", job.kind)
                job.error = str(exc) or exc.__class__.__name__
                job.status = "error"

        task = asyncio.create_task(wrapper())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)


store = JobStore()
