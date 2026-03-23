import asyncpg
from app.config import settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            settings.POSTGRES_URL,
            min_size=2,
            max_size=20,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def get_db():
    """FastAPI dependency that yields a connection from the pool."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn
