"""Force-set a user's password.

Usage (run from the backend/ directory):
    python reset_password.py <username> <new_password>

Example:
    python reset_password.py James "S3cret!pass"
"""

import sys

from app.database import SessionLocal
from app.models.user import User
from app.services.auth import hash_password, new_token


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python reset_password.py <username> <new_password>")
        raise SystemExit(1)

    username, new_password = sys.argv[1], sys.argv[2]

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            print(f"No user named {username!r} found.")
            raise SystemExit(1)

        user.password_hash = hash_password(new_password)
        user.token = new_token()  # invalidate existing sessions
        db.commit()
        print(f"Password updated for {username!r}. Existing sessions were logged out.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
