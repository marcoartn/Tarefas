#!/usr/bin/env python3
import argparse
import json
import os
import sys
from datetime import datetime

DEFAULT_STORE = os.path.expanduser("~/.tarefas.json")


def store_path():
    return os.environ.get("TAREFAS_FILE", DEFAULT_STORE)


def load_tasks():
    path = store_path()
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_tasks(tasks):
    path = store_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(tasks, f, ensure_ascii=False, indent=2)


def next_id(tasks):
    return max((t["id"] for t in tasks), default=0) + 1


def cmd_add(args):
    tasks = load_tasks()
    task = {
        "id": next_id(tasks),
        "title": args.title,
        "priority": args.priority,
        "due": args.due,
        "done": False,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    tasks.append(task)
    save_tasks(tasks)
    print(f"Tarefa #{task['id']} criada: {task['title']}")


def cmd_list(args):
    tasks = load_tasks()
    if args.status == "pending":
        tasks = [t for t in tasks if not t["done"]]
    elif args.status == "done":
        tasks = [t for t in tasks if t["done"]]

    if not tasks:
        print("Nenhuma tarefa encontrada.")
        return

    for t in sorted(tasks, key=lambda t: t["id"]):
        status = "x" if t["done"] else " "
        due = f" (prazo: {t['due']})" if t.get("due") else ""
        priority = f" [{t['priority']}]" if t.get("priority") else ""
        print(f"[{status}] #{t['id']} {t['title']}{priority}{due}")


def find_task(tasks, task_id):
    for t in tasks:
        if t["id"] == task_id:
            return t
    return None


def cmd_done(args):
    tasks = load_tasks()
    task = find_task(tasks, args.id)
    if not task:
        print(f"Tarefa #{args.id} não encontrada.", file=sys.stderr)
        sys.exit(1)
    task["done"] = True
    save_tasks(tasks)
    print(f"Tarefa #{task['id']} marcada como concluída.")


def cmd_remove(args):
    tasks = load_tasks()
    task = find_task(tasks, args.id)
    if not task:
        print(f"Tarefa #{args.id} não encontrada.", file=sys.stderr)
        sys.exit(1)
    tasks.remove(task)
    save_tasks(tasks)
    print(f"Tarefa #{args.id} removida.")


def cmd_edit(args):
    tasks = load_tasks()
    task = find_task(tasks, args.id)
    if not task:
        print(f"Tarefa #{args.id} não encontrada.", file=sys.stderr)
        sys.exit(1)
    if args.title is not None:
        task["title"] = args.title
    if args.priority is not None:
        task["priority"] = args.priority
    if args.due is not None:
        task["due"] = args.due
    save_tasks(tasks)
    print(f"Tarefa #{task['id']} atualizada.")


def build_parser():
    parser = argparse.ArgumentParser(prog="tarefas", description="Gerenciador de tarefas via linha de comando.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_add = sub.add_parser("add", help="Adiciona uma nova tarefa")
    p_add.add_argument("title", help="Título da tarefa")
    p_add.add_argument("--priority", choices=["baixa", "media", "alta"], default=None)
    p_add.add_argument("--due", default=None, help="Prazo (ex: 2026-09-20)")
    p_add.set_defaults(func=cmd_add)

    p_list = sub.add_parser("list", help="Lista as tarefas")
    p_list.add_argument("--status", choices=["all", "pending", "done"], default="all")
    p_list.set_defaults(func=cmd_list)

    p_done = sub.add_parser("done", help="Marca uma tarefa como concluída")
    p_done.add_argument("id", type=int)
    p_done.set_defaults(func=cmd_done)

    p_remove = sub.add_parser("remove", help="Remove uma tarefa")
    p_remove.add_argument("id", type=int)
    p_remove.set_defaults(func=cmd_remove)

    p_edit = sub.add_parser("edit", help="Edita uma tarefa existente")
    p_edit.add_argument("id", type=int)
    p_edit.add_argument("--title", default=None)
    p_edit.add_argument("--priority", choices=["baixa", "media", "alta"], default=None)
    p_edit.add_argument("--due", default=None)
    p_edit.set_defaults(func=cmd_edit)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
