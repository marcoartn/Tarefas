import json
import os
import subprocess
import sys
import tempfile

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "tarefas.py")


def run(args, store_file):
    env = os.environ.copy()
    env["TAREFAS_FILE"] = store_file
    result = subprocess.run(
        [sys.executable, SCRIPT] + args,
        capture_output=True,
        text=True,
        env=env,
    )
    return result


def test_add_list_done_remove():
    with tempfile.TemporaryDirectory() as tmp:
        store = os.path.join(tmp, "tasks.json")

        r = run(["add", "Comprar leite", "--priority", "alta"], store)
        assert r.returncode == 0
        assert "Tarefa #1 criada" in r.stdout

        r = run(["list"], store)
        assert "#1 Comprar leite" in r.stdout

        r = run(["done", "1"], store)
        assert r.returncode == 0

        with open(store) as f:
            tasks = json.load(f)
        assert tasks[0]["done"] is True

        r = run(["remove", "1"], store)
        assert r.returncode == 0

        with open(store) as f:
            tasks = json.load(f)
        assert tasks == []


def test_done_nonexistent_fails():
    with tempfile.TemporaryDirectory() as tmp:
        store = os.path.join(tmp, "tasks.json")
        r = run(["done", "99"], store)
        assert r.returncode == 1
        assert "não encontrada" in r.stderr
