"""
recorder.py — JSON 记录存档
"""
import json
import os
from datetime import datetime

BASE_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RECORDS_PATH = os.path.join(BASE_DIR, 'records.json')


def _load():
    if not os.path.exists(RECORDS_PATH):
        return []
    with open(RECORDS_PATH, encoding='utf-8') as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return []


def _save(records):
    with open(RECORDS_PATH, 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False, indent=2, default=str)


def add_record(data):
    records = _load()
    data['id']        = len(records) + 1
    data['timestamp'] = datetime.now().isoformat()
    records.append(data)
    _save(records)
    return data['id']


def update_record(record_id, updates):
    records = _load()
    for r in records:
        if r.get('id') == record_id:
            r.update(updates)
            break
    _save(records)


def get_all():
    return _load()


def get_by_id(record_id):
    return next((r for r in _load() if r.get('id') == record_id), None)
