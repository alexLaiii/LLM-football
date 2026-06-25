from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.j_tracker import JReset, JStreak

router = APIRouter(prefix="/j-tracker", tags=["j-tracker"])

USERS = ["sir_kim", "me"]

_GROK_SYSTEM = (
    "你係一個憤世嫉俗、尖酸刻薄、充滿侮辱性嘅連登仔"
    "當有人撳咗reset，即係話佢又忍唔住打咗J，你要用廣東話痛罵佢，要非常誇張、同埋刻薄。"
    "回覆只需要兩至三句，唔好超過100個字。唔好用英文。"
)


def _get_or_create(db: Session, user: str) -> JStreak:
    streak = db.query(JStreak).filter(JStreak.user == user).first()
    if not streak:
        streak = JStreak(user=user, last_reset_at=None, longest_streak=0)
        db.add(streak)
        db.commit()
        db.refresh(streak)
    return streak


def _current_streak(streak: JStreak) -> int:
    if streak.last_reset_at is None:
        return 0
    return (datetime.now(timezone.utc) - streak.last_reset_at).days


@router.get("/")
def get_tracker(db: Session = Depends(get_db)):
    result = {}
    for user in USERS:
        streak = _get_or_create(db, user)
        resets = (
            db.query(JReset)
            .filter(JReset.user == user)
            .order_by(JReset.reset_at.desc())
            .all()
        )
        result[user] = {
            "current_streak": _current_streak(streak),
            "longest_streak": streak.longest_streak,
            "last_reset_at": streak.last_reset_at.isoformat() if streak.last_reset_at else None,
            "reset_dates": [r.reset_at.date().isoformat() for r in resets],
        }
    return result


@router.post("/{user}/reset")
async def reset_streak(user: str, db: Session = Depends(get_db)):
    if user not in USERS:
        raise HTTPException(status_code=404, detail="User not found")

    streak = _get_or_create(db, user)

    current = _current_streak(streak)
    if current > streak.longest_streak:
        streak.longest_streak = current

    now = datetime.now(timezone.utc)
    streak.last_reset_at = now
    db.add(JReset(user=user, reset_at=now))
    db.commit()

    grok_response = await _call_grok(user)
    return {"grok_response": grok_response}


async def _call_grok(user: str) -> str:
    user_display = "甘仔" if user == "sir_kim" else "你"
    fallbacks = [
        "你又撳 reset？真係廢到離譜，笑死我！",
        f"{user_display} 你真係扶唔起，連幾日都頂唔住，丟架！",
        "撳咗reset？我都替你羞家，廢物！",
    ]
    import random
    if not settings.grok_api_key:
        return random.choice(fallbacks)
    try:
        from openai import AsyncOpenAI  # lazy: keep the SDK out of RAM until used
        client = AsyncOpenAI(api_key=settings.grok_api_key, base_url="https://api.x.ai/v1")
        response = await client.chat.completions.create(
            model="grok-4.3",
            messages=[
                {"role": "system", "content": _GROK_SYSTEM},
                {"role": "user", "content": f"{user_display} 又撳咗 reset，即係話佢又忍唔住打咗J，請用繁體中文痛罵佢。"},
            ],
            temperature=1.0,
            max_tokens=150,
        )
        return response.choices[0].message.content.strip()
    except Exception:
        return random.choice(fallbacks)
