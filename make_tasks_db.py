"""data/tasks.json 을 SQLite 파일(data/tasks.db)로 만들고 SQL 로 조회한다.

파이썬 기본 기능만 쓴다 (sqlite3 · json · pathlib).
tasks.db 는 .gitignore 의 *.db 규칙으로 GitHub 에 올라가지 않는다.

실행: python make_tasks_db.py
"""

import json
import sqlite3
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent
JSON_PATH = BASE_DIR / "data" / "tasks.json"
DB_PATH = BASE_DIR / "data" / "tasks.db"

# 구분(kind)에 들어갈 수 있는 값
ALLOWED_KINDS = ("야외", "고소", "실내")

CREATE_TABLE_SQL = """
CREATE TABLE tasks (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    title  TEXT NOT NULL,
    region TEXT NOT NULL,
    kind   TEXT NOT NULL CHECK (kind IN ('야외', '고소', '실내')),
    owner  TEXT NOT NULL
)
"""


def build_database():
    """JSON 을 읽어 tasks.db 를 새로 만든다."""
    tasks = json.loads(JSON_PATH.read_text(encoding="utf-8"))

    # 다시 실행해도 같은 결과가 나오도록 기존 파일을 지우고 새로 만든다
    DB_PATH.unlink(missing_ok=True)

    conn = sqlite3.connect(DB_PATH)
    conn.execute(CREATE_TABLE_SQL)
    conn.executemany(
        "INSERT INTO tasks (title, region, kind, owner) VALUES (?, ?, ?, ?)",
        [(t["title"], t["region"], t["kind"], t["owner"]) for t in tasks],
    )
    conn.commit()
    return conn


def print_rows(title, rows, headers):
    """조회 결과를 보기 좋게 찍는다."""
    print(f"\n{title}")
    print("-" * 52)
    print(" | ".join(headers))
    print("-" * 52)
    for row in rows:
        print(" | ".join(str(value) for value in row))


def check_constraint_works(conn):
    """CHECK 규칙이 실제로 막는지 확인한다."""
    try:
        conn.execute(
            "INSERT INTO tasks (title, region, kind, owner) VALUES (?, ?, ?, ?)",
            ("잘못된 구분 시험", "세종", "수중", "시험"),
        )
    except sqlite3.IntegrityError as e:
        conn.rollback()
        return f"막힘 ({e})"
    conn.rollback()
    return "막지 못함 - 규칙을 확인하세요"


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    conn = build_database()

    total = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    print(f"{DB_PATH} 생성 완료 - 일정 {total}건")

    # ① 지역별 일정 수
    rows = conn.execute(
        """
        SELECT region, COUNT(*) AS 일정수
        FROM tasks
        GROUP BY region
        ORDER BY 일정수 DESC, region
        """
    ).fetchall()
    print_rows("① 지역별 일정 수", rows, ["지역", "일정 수"])

    # ② 고소 일정만
    rows = conn.execute(
        """
        SELECT title, region, owner
        FROM tasks
        WHERE kind = '고소'
        ORDER BY region, title
        """
    ).fetchall()
    print_rows("② 고소 일정만", rows, ["일정", "지역", "담당"])

    # CHECK 규칙 확인
    print(f"\nCHECK 규칙 확인 - 구분에 '수중' 넣어 보기: {check_constraint_works(conn)}")
    print(f"허용되는 구분: {' · '.join(ALLOWED_KINDS)}")

    conn.close()


if __name__ == "__main__":
    main()
