from pydantic_settings import BaseSettings
import yaml
import os


class Settings(BaseSettings):
    API_GATEWAY_URL: str = "http://localhost:8000"
    REDIS_URL: str = "redis://localhost:6379"
    BOT_USERNAME: str = "marketmaker"
    BOT_PASSWORD: str = "mmbot_pass"
    STOCKS_CONFIG: str = "/shared/stocks.yaml"

    # Market making parameters
    SPREAD: float = 0.001         # 0.1% half-spread
    QUOTE_SIZE: float = 10.0      # units per side
    REFRESH_INTERVAL_S: float = 0.5

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
