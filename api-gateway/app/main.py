"""
API Gateway – FastAPI

Exposes REST endpoints for order management and market data.
All routes prefixed with /api/v1
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import get_pool, close_pool
from app.engine_client import get_engine_pool, close_engine_pool
from app.redis_client import get_redis, close_redis
from app.routers import auth, orders, market

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [api-gateway] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting API Gateway...")

    # Initialise connection pools
    await get_pool()
    log.info("PostgreSQL pool ready")

    await get_redis()
    log.info("Redis client ready")

    await get_engine_pool()
    log.info("Engine connection pool ready")

    yield

    # Teardown
    await close_engine_pool()
    await close_redis()
    await close_pool()
    log.info("API Gateway shut down")


app = FastAPI(
    title="Synthetic-Bull API Gateway",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ─────────────────────────────────────────────────────────────────

app.include_router(auth.router)
app.include_router(orders.router)
app.include_router(market.router)


# ─── Health check ────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "symbols": settings.symbols}
