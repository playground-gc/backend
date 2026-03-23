from pydantic_settings import BaseSettings
import yaml
import os


class Settings(BaseSettings):
    API_GATEWAY_URL: str = "http://localhost:8000"
    REDIS_URL: str = "redis://localhost:6379"
    BOT_USERNAME: str = "alphabot"
    BOT_PASSWORD: str = "alphabot_pass"
    STOCKS_CONFIG: str = "/shared/stocks.yaml"

    # Strategy parameters
    SMA_FAST: int = 10
    SMA_SLOW: int = 50
    CANDLE_INTERVAL: str = "1m"
    STRATEGY_TICK_S: float = 10.0
    MIN_ORDER_INTERVAL_S: float = 30.0
    ORDER_QUANTITY: float = 5.0

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
