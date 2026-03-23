from pydantic_settings import BaseSettings
import yaml
import os


class Settings(BaseSettings):
    REDIS_URL: str = "redis://localhost:6379"
    STOCKS_CONFIG: str = "/shared/stocks.yaml"
    WS_PORT: int = 8001

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
