from fastapi import APIRouter, HTTPException, Depends
from app.schemas import RegisterRequest, LoginRequest, TokenResponse
from app.auth import hash_password, verify_password, create_token
from app.database import get_db

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, db=Depends(get_db)):
    # Check username/email uniqueness
    existing = await db.fetchrow(
        "SELECT id FROM users WHERE username=$1 OR email=$2",
        body.username, body.email,
    )
    if existing:
        raise HTTPException(status_code=409, detail="Username or email already taken")

    pw_hash = hash_password(body.password)
    row = await db.fetchrow(
        """
        INSERT INTO users (username, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, username
        """,
        body.username, body.email, pw_hash,
    )
    token = create_token(str(row["id"]), row["username"])
    return TokenResponse(
        access_token=token,
        user_id=str(row["id"]),
        username=row["username"],
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db=Depends(get_db)):
    row = await db.fetchrow(
        "SELECT id, username, password_hash FROM users WHERE username=$1",
        body.username,
    )
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token(str(row["id"]), row["username"])
    return TokenResponse(
        access_token=token,
        user_id=str(row["id"]),
        username=row["username"],
    )
