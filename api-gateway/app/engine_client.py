"""
Async TCP connection pool to the matching engine.
Fire-and-forget: we send JSON orders and do not wait for a response.
Fills are delivered asynchronously via WebSocket (Redis pub/sub).
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager

from app.config import settings

log = logging.getLogger(__name__)


class EngineConnectionPool:
    def __init__(self, host: str, port: int, pool_size: int = 5) -> None:
        self.host      = host
        self.port      = port
        self.pool_size = pool_size
        self._pool: asyncio.Queue[
            tuple[asyncio.StreamReader, asyncio.StreamWriter]
        ] = asyncio.Queue()
        self._initialized = False

    async def initialize(self) -> None:
        for _ in range(self.pool_size):
            reader, writer = await asyncio.open_connection(self.host, self.port)
            await self._pool.put((reader, writer))
        self._initialized = True
        log.info("Engine connection pool initialized (%d connections)", self.pool_size)

    @asynccontextmanager
    async def acquire(self):
        reader, writer = await self._pool.get()

        # Test the connection; reconnect if it's dead before yielding.
        if writer.is_closing():
            try:
                writer.close()
            except Exception:
                pass
            try:
                reader, writer = await asyncio.open_connection(self.host, self.port)
                log.info("Reconnected to matching engine")
            except Exception as e:
                log.error("Failed to reconnect to engine: %s", e)
                await self._pool.put((reader, writer))
                raise

        try:
            yield reader, writer
        except (ConnectionResetError, BrokenPipeError, OSError) as e:
            # Connection died during use – open a fresh one for the pool.
            log.warning("Engine connection lost (%s), replacing...", e)
            try:
                writer.close()
            except Exception:
                pass
            try:
                reader, writer = await asyncio.open_connection(self.host, self.port)
            except Exception as reconnect_err:
                log.error("Reconnect failed: %s", reconnect_err)
            raise  # re-raise the original error to the caller
        finally:
            await self._pool.put((reader, writer))

    async def send_order(self, order_dict: dict) -> None:
        payload = json.dumps(order_dict) + "\n"
        async with self.acquire() as (_reader, writer):
            writer.write(payload.encode())
            await writer.drain()

    async def close(self) -> None:
        while not self._pool.empty():
            try:
                _, writer = self._pool.get_nowait()
                writer.close()
            except Exception:
                pass


# ─── Module-level singleton ───────────────────────────────────────────────────

_engine_pool: EngineConnectionPool | None = None


async def get_engine_pool() -> EngineConnectionPool:
    global _engine_pool
    if _engine_pool is None or not _engine_pool._initialized:
        _engine_pool = EngineConnectionPool(
            settings.ENGINE_HOST,
            settings.ENGINE_PORT,
            settings.ENGINE_POOL_SIZE,
        )
        await _engine_pool.initialize()
    return _engine_pool


async def close_engine_pool() -> None:
    global _engine_pool
    if _engine_pool:
        await _engine_pool.close()
        _engine_pool = None
