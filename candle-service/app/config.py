from pydantic_settings import BaseSettings
import yaml
import os


class Settings(BaseSettings):
    REDIS_URL: str = "redis://localhost:6379"
    POSTGRES_URL: str = "postgresql://synthbull:synthbull_pass@localhost:5432/synthbull"
    STOCKS_CONFIG: str = "/shared/stocks.yaml"

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
