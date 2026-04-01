from pydantic_settings import BaseSettings
import yaml
import os


class Settings(BaseSettings):
    API_GATEWAY_URL: str = "http://localhost:8000"
    REDIS_URL: str = "redis://localhost:6379"
    BOT_USERNAME: str = "marketmaker"
    BOT_PASSWORD: str = "mmbot_pass"
    STOCKS_CONFIG: str = "/shared/stocks.yaml"

    # ── Avellaneda-Stoikov strategy parameters ─────────────────────────────
    # gamma   — risk-aversion coefficient.
    #           Low (0.001): near risk-neutral, wide inventory tolerance.
    #           High (0.1):  aggressively skews quotes to flatten inventory.
    #           Scale with the market TPS: lower gamma for lower TPS.
    GAMMA: float = 0.001

    # k       — order-arrival intensity decay rate per unit of spread.
    #           Higher k → fills concentrate near tight quotes.
    K: float = 1.5

    # T_TICKS — rolling strategy horizon in ticks.
    #           The bot resets the horizon every T_TICKS ticks so inventory
    #           skew stays active indefinitely (open-ended running).
    T_TICKS: int = 500

    # Q_MAX   — soft long inventory cap per symbol.
    #           Quote placement is skipped when q >= Q_MAX to prevent runaway
    #           long positions.
    Q_MAX: int = 20

    # SHORT_MAX — maximum allowed short position (shares sold beyond holdings).
    #             A user with X shares may sell at most X + SHORT_MAX shares in
    #             total.  Once q <= -SHORT_MAX, no further sell orders are placed.
    SHORT_MAX: int = 5

    # TPS     — ticks per second, used to calibrate the Poisson fill intensity.
    #           Should match MARKET_TPS of the market-generator.
    TPS: int = 10

    # VOL_EMA_ALPHA — EMA decay for the local per-tick vol estimate (F2).
    #                 Matches gbm.cpp vol_ema_alpha (half-life ≈ 139 ticks).
    VOL_EMA_ALPHA: float = 0.005

    @property
    def symbols(self) -> list[str]:
        path = self.STOCKS_CONFIG
        if not os.path.exists(path):
            return []
        with open(path) as f:
            data = yaml.safe_load(f)
        return [s["symbol"] for s in data.get("stocks", [])]

    class Config:
        env_file = ".env"


settings = Settings()
